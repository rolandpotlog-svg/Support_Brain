// IMAP-Ingest + Ordner-Spiegelung. Der Server-Posteingang (INBOX) enthält nur offene
// Fälle; Bearbeitetes wandert in Wartet/Erledigt, Gesendetes wird in Gesendet abgelegt.
// Quelle der Wahrheit ist der Ticket-Status im Tool. NIEMALS löschen — nur verschieben.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { decrypt } from "../src/lib/mailbox/crypto";
import { bestBodyText } from "../src/lib/mailbox/html-text";
import { bestCustomerEmail, nameFromBody } from "../src/lib/mailbox/extract";
import { aiConfigured } from "../src/server/ai";
import { generateDraft } from "../src/server/ai/draft";
import { compareShadow, stripQuoted } from "../src/server/ai/shadow-compare";

const RE_PREFIX = /^\s*(re|aw|fwd|wg)\s*:\s*/i;

function normalizeSubject(subject: string | null | undefined): string {
  let s = subject ?? "";
  while (RE_PREFIX.test(s)) s = s.replace(RE_PREFIX, "");
  return s.trim().toLowerCase();
}

type Folders = { inbox: string; wartet: string; erledigt: string; sent: string; trash: string; junk: string };
type MailboxRow = typeof schema.shopMailboxes.$inferSelect;

/** Ordner sicherstellen (anlegen, falls fehlend) + Sent-Ordner finden. */
async function setupFolders(client: ImapFlow): Promise<Folders> {
  const list = await client.list();
  const up = (p: string) => p.toUpperCase();
  const inbox = list.find((m) => up(m.path) === "INBOX");
  const delim = inbox?.delimiter || "/";
  const nested = list.some((m) => up(m.path) !== "INBOX" && m.path.startsWith("INBOX" + delim));
  const prefix = nested ? "INBOX" + delim : "";
  const wartet = prefix + "Wartet";
  const erledigt = prefix + "Erledigt";

  for (const f of [wartet, erledigt]) {
    if (!list.some((m) => m.path === f)) {
      try {
        await client.mailboxCreate(f);
      } catch {
        /* existiert schon */
      }
    }
  }

  // Sonder-Ordner (Gesendet/Papierkorb/Junk) über specialUse oder gängige Namen finden, sonst anlegen.
  const findSpecial = async (special: string, names: string[], fallback: string): Promise<string> => {
    let path = list.find((m) => m.specialUse === special)?.path;
    if (!path) path = list.find((m) => names.some((n) => up(m.path) === up(n)))?.path;
    if (!path) {
      path = prefix + fallback;
      if (!list.some((m) => m.path === path)) {
        try {
          await client.mailboxCreate(path);
        } catch {
          /* existiert schon / egal */
        }
      }
    }
    return path;
  };

  const sent = await findSpecial(
    "\\Sent",
    ["Sent", "Gesendet", "Sent Items", "Gesendete Objekte", prefix + "Sent", prefix + "Gesendet"],
    "Gesendet",
  );
  const trash = await findSpecial(
    "\\Trash",
    ["Trash", "Papierkorb", "Deleted", "Deleted Items", "Deleted Messages", "Gelöscht", "Gelöschte Objekte", prefix + "Papierkorb"],
    "Papierkorb",
  );
  const junk = await findSpecial(
    "\\Junk",
    ["Junk", "Spam", "Junk E-mail", "Junk Email", "Bulk Mail", prefix + "Spam"],
    "Spam",
  );
  return { inbox: "INBOX", wartet, erledigt, sent, trash, junk };
}

/** Ziel-Ordner aus dem Ticket-Zustand (Tool ist führend). */
function desiredFolder(status: string, deletedAt: Date | null, F: Folders): string {
  if (deletedAt) return F.trash; // gelöscht -> Papierkorb
  if (status === "closed") return F.erledigt; // abgeschlossen -> Erledigt
  if (status === "pending") return F.wartet;
  if (status === "spam") return F.junk; // Spam -> Junk-Ordner
  return F.inbox; // open, escalated -> bleibt im Posteingang
}

function encHeader(s: string): string {
  return /[^\x00-\x7F]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s;
}

function buildMime(o: { toEmail: string | null; subject: string | null; bodyText: string | null; messageId: string | null; inReplyTo: string | null; createdAt: Date }, mb: MailboxRow): string {
  const from = mb.fromName ? `${encHeader(mb.fromName)} <${mb.fromEmail}>` : mb.fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${o.toEmail ?? ""}`,
    `Subject: ${encHeader(o.subject ?? "")}`,
    `Date: ${new Date(o.createdAt).toUTCString()}`,
    o.messageId ? `Message-ID: ${o.messageId}` : "",
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ].filter(Boolean);
  return headers.join("\r\n") + "\r\n\r\n" + (o.bodyText ?? "");
}

async function resolveThreadId(
  shopId: string,
  mailboxId: string,
  customerEmail: string,
  subject: string | null,
  refIds: string[],
): Promise<string> {
  if (refIds.length) {
    // WICHTIG: nur innerhalb DESSELBEN Shops zuordnen — sonst kann eine Antwort im falschen
    // Shop landen, wenn eine Referenz-Message-ID zufällig zu einem Ticket des anderen Shops passt.
    const m = await db
      .select({ threadId: schema.messages.threadId })
      .from(schema.messages)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
      .where(and(inArray(schema.messages.messageId, refIds), eq(schema.threads.shopId, shopId)))
      .limit(1);
    if (m.length) return m[0].threadId;
  }

  const norm = normalizeSubject(subject);
  if (norm) {
    const candidates = await db
      .select({ id: schema.threads.id, subject: schema.threads.subject })
      .from(schema.threads)
      .where(
        and(
          eq(schema.threads.shopId, shopId),
          sql`lower(${schema.threads.customerEmail}) = lower(${customerEmail})`,
          sql`${schema.threads.status} <> 'closed'`,
        ),
      )
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(50);
    for (const c of candidates) {
      if (normalizeSubject(c.subject) === norm) return c.id;
    }
  }

  const [created] = await db
    .insert(schema.threads)
    .values({ shopId, mailboxId, subject: subject ?? null, customerEmail })
    .returning({ id: schema.threads.id });
  return created.id;
}

/** Bearbeitete Mails serverseitig in den passenden Ordner spiegeln (Status -> Ordner). */
async function reconcileFolders(client: ImapFlow, mb: MailboxRow, F: Folders) {
  // Verschieben via messageMove: nutzt MOVE, falls vorhanden — sonst emuliert ImapFlow via COPY+EXPUNGE.
  // (Kein früher Abbruch mehr bei fehlender MOVE-Capability; sonst blieb alles im Posteingang liegen.)
  const rows = await db
    .select({
      id: schema.messages.id,
      imapUid: schema.messages.imapUid,
      imapFolder: schema.messages.imapFolder,
      status: schema.threads.status,
      deletedAt: schema.threads.deletedAt,
    })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(
      and(
        eq(schema.threads.mailboxId, mb.id),
        eq(schema.messages.direction, "inbound"),
        isNotNull(schema.messages.imapFolder),
        isNotNull(schema.messages.imapUid),
      ),
    );

  const moves = rows
    .map((r) => ({ ...r, target: desiredFolder(r.status, r.deletedAt, F) }))
    .filter((r) => r.target !== r.imapFolder);
  if (!moves.length) return;

  const bySource = new Map<string, typeof moves>();
  for (const m of moves) {
    const arr = bySource.get(m.imapFolder!) ?? [];
    arr.push(m);
    bySource.set(m.imapFolder!, arr);
  }

  for (const [src, group] of bySource) {
    let lock;
    try {
      lock = await client.getMailboxLock(src);
    } catch {
      continue; // Quell-Ordner nicht öffenbar
    }
    try {
      for (const m of group) {
        try {
          const res = await client.messageMove(String(m.imapUid), m.target, { uid: true });
          let newUid: number | null = null;
          if (res && res.uidMap) {
            for (const v of res.uidMap.values()) newUid = Number(v);
          }
          await db
            .update(schema.messages)
            .set({ imapFolder: m.target, imapUid: newUid })
            .where(eq(schema.messages.id, m.id));
        } catch (e) {
          console.error(`[reconcile] Move ${m.id} -> ${m.target}:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      lock.release();
    }
  }
}

/** Gesendete Antworten zusätzlich im Gesendet-Ordner ablegen (IMAP APPEND), für volle Historie. */
async function appendSent(client: ImapFlow, mb: MailboxRow, F: Folders) {
  const outs = await db
    .select({
      id: schema.messages.id,
      toEmail: schema.messages.toEmail,
      subject: schema.messages.subject,
      bodyText: schema.messages.bodyText,
      messageId: schema.messages.messageId,
      inReplyTo: schema.messages.inReplyTo,
      createdAt: schema.messages.createdAt,
    })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .innerJoin(schema.outbox, eq(schema.outbox.messageId, schema.messages.id))
    .where(
      and(
        eq(schema.threads.mailboxId, mb.id),
        eq(schema.messages.direction, "outbound"),
        eq(schema.outbox.status, "sent"),
        sql`${schema.messages.imapFolder} is null`,
      ),
    );

  for (const o of outs) {
    try {
      await client.append(F.sent, buildMime(o, mb), ["\\Seen"]);
      await db.update(schema.messages).set({ imapFolder: F.sent }).where(eq(schema.messages.id, o.id));
    } catch (e) {
      console.error(`[sent] Append ${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Gesendet-Ordner nur FINDEN (Schattenbetrieb: nichts anlegen). */
async function findSentReadOnly(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  const up = (p: string) => p.toUpperCase();
  const names = ["SENT", "GESENDET", "SENT ITEMS", "GESENDETE OBJEKTE", "INBOX.SENT", "INBOX.GESENDET", "INBOX/SENT", "INBOX/GESENDET"];
  return list.find((m) => m.specialUse === "\\Sent")?.path ?? list.find((m) => names.includes(up(m.path)))?.path ?? null;
}

/**
 * Antworten, die NICHT über das Tool rausgingen (Webmail), aus dem Gesendet-Ordner (nur lesend) ins Ticket übernehmen.
 * - Schattenbetrieb: zusätzlich mit dem KI-Entwurf vergleichen. Erster Lauf: nur Position merken.
 * - Live: kein KI-Vergleich (zählt nicht in die Statistik), Ticket wird als beantwortet markiert.
 *   Nur die letzten 3 Tage — so landen Notfall-Antworten aus dem Webmail sicher im Tool, ohne Altbestand.
 */
async function ingestSent(
  client: ImapFlow,
  shop: typeof schema.shops.$inferSelect,
  mb: MailboxRow,
  sentPath: string,
  mode: "shadow" | "live",
): Promise<number> {
  const lock = await client.getMailboxLock(sentPath, { readOnly: true });
  let n = 0;
  let maxUid = mb.lastSeenSentUid ?? 0;
  try {
    const box = client.mailbox;
    const uidNext = box && typeof box === "object" && box.uidNext ? Number(box.uidNext) : 1;
    let uids: number[];
    if (mode === "shadow") {
      if (mb.lastSeenSentUid == null) {
        await db.update(schema.shopMailboxes).set({ lastSeenSentUid: uidNext - 1 }).where(eq(schema.shopMailboxes.id, mb.id));
        return 0;
      }
      if (uidNext - 1 <= mb.lastSeenSentUid) return 0;
      const found = await client.search({ uid: `${mb.lastSeenSentUid + 1}:*` }, { uid: true });
      uids = Array.isArray(found) ? found : [];
    } else {
      const since = new Date(Date.now() - 3 * 86_400_000);
      const from = (mb.lastSeenSentUid ?? 0) + 1;
      if (uidNext - 1 < from) return 0;
      const found = await client.search({ uid: `${from}:*`, since }, { uid: true });
      uids = Array.isArray(found) ? found : [];
      maxUid = Math.max(maxUid, uidNext - 1);
    }
    uids = uids.filter((u) => u > (mb.lastSeenSentUid ?? 0));
    if (!uids.length) return 0;

    const aiOn = mode === "shadow" && aiConfigured() && !shop.killSwitch;
    for await (const msg of client.fetch(uids.join(","), { uid: true, source: true }, { uid: true })) {
      if (msg.uid <= (mb.lastSeenSentUid ?? 0) || !msg.source) continue;
      maxUid = Math.max(maxUid, msg.uid);
      try {
        const parsed = await simpleParser(msg.source);
        const messageId = parsed.messageId ?? null;
        // Eigene Kopien (vom Tool gesendet und in Gesendet abgelegt) nie doppelt übernehmen.
        if (messageId && /@support-brain>?$/.test(messageId)) continue;
        if (messageId && (await db.query.messages.findFirst({ where: eq(schema.messages.messageId, messageId) }))) continue;
        const to = parsed.to && !Array.isArray(parsed.to) ? parsed.to.value?.[0]?.address : Array.isArray(parsed.to) ? parsed.to[0]?.value?.[0]?.address : undefined;
        if (!to) continue;
        const inReplyTo = parsed.inReplyTo ?? null;
        const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
        const refIds = [inReplyTo, ...refs].filter(Boolean) as string[];

        // Zugehöriges Ticket: über Message-IDs (sicher), sonst Kunde + Betreff. Ohne Treffer ignorieren
        // (z. B. eigene Mails an Lieferanten) — wir legen hier nie neue Tickets an.
        let threadId: string | null = null;
        if (refIds.length) {
          const m = await db
            .select({ threadId: schema.messages.threadId })
            .from(schema.messages)
            .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
            .where(and(inArray(schema.messages.messageId, refIds), eq(schema.threads.shopId, shop.id)))
            .limit(1);
          threadId = m[0]?.threadId ?? null;
        }
        if (!threadId) {
          const norm = normalizeSubject(parsed.subject);
          const cands = await db
            .select({ id: schema.threads.id, subject: schema.threads.subject })
            .from(schema.threads)
            .where(and(eq(schema.threads.shopId, shop.id), sql`lower(${schema.threads.customerEmail}) = lower(${to})`))
            .orderBy(desc(schema.threads.lastMessageAt))
            .limit(20);
          threadId = cands.find((c) => norm && normalizeSubject(c.subject) === norm)?.id ?? null;
        }
        if (!threadId) continue;

        const body = stripQuoted(bestBodyText(parsed.text ?? null, typeof parsed.html === "string" ? parsed.html : null) ?? "");
        if (!body) continue;

        let t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
        if (!t) continue;
        const lastIn = await db.query.messages.findFirst({
          where: and(eq(schema.messages.threadId, threadId), eq(schema.messages.direction, "inbound")),
          orderBy: desc(schema.messages.createdAt),
        });

        // Schattenbetrieb: liegt noch kein Entwurf zur aktuellen Kundenmail vor? Dann jetzt erzeugen + vergleichen.
        let match: boolean | null = null;
        let note: string | null = null;
        if (aiOn) {
          const hasProfile = await db.query.shopProfile.findFirst({ where: eq(schema.shopProfile.shopId, shop.id) });
          if (hasProfile && lastIn && (!t.lastAiDraft || !t.aiDraftAt || t.aiDraftAt < lastIn.createdAt)) {
            try {
              await generateDraft(threadId);
              t = (await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) })) ?? t;
            } catch (e) {
              console.error(`[shadow] Entwurf ${threadId}:`, e instanceof Error ? e.message : e);
            }
          }
          if (t.lastAiDraft && lastIn) {
            try {
              const c = await compareShadow({ customerText: lastIn.bodyText ?? "", draft: t.lastAiDraft, actual: body });
              match = c.match;
              note = c.note || null;
            } catch (e) {
              console.error(`[shadow] Vergleich ${threadId}:`, e instanceof Error ? e.message : e);
            }
          }
        }

        const sentAt = parsed.date ?? new Date();
        // Hat der Kunde NACH dieser Webmail-Antwort nochmal geschrieben, bleibt das Ticket offen.
        const answersLatest = !lastIn || sentAt >= lastIn.createdAt;
        await db.transaction(async (tx) => {
          await tx.insert(schema.messages).values({
            threadId: threadId!,
            direction: "outbound",
            fromEmail: mb.fromEmail,
            toEmail: to,
            subject: parsed.subject ?? null,
            bodyText: body,
            messageId,
            inReplyTo,
            imapUid: msg.uid,
            imapFolder: null, // nie spiegeln/verschieben
            aiOutcome: mode === "live" ? "webmail" : t!.lastAiDraft ? "shadow" : "manual",
            aiDraft: mode === "live" ? null : (t!.lastAiDraft ?? null),
            aiDecision: mode === "live" ? null : t!.lastAiDraft ? t!.aiDecision : null,
            aiShadowMatch: match,
            aiShadowNote: note,
            createdAt: sentAt,
          }).onConflictDoNothing();
          if (mode === "shadow") {
            await tx
              .update(schema.threads)
              .set({
                status: "pending",
                lastMessageAt: sentAt,
                firstResponseAt: t!.firstResponseAt ?? sentAt,
                lastAiDraft: null,
                aiDecision: null,
                aiReason: null,
                aiDraftAt: null,
              })
              .where(eq(schema.threads.id, threadId!));
          } else if (answersLatest) {
            // Wie eine Antwort aus dem Tool: offen -> wartet; eskaliert/Spam/erledigt bleiben, wie sie sind.
            await tx
              .update(schema.threads)
              .set({
                status: sql`case when ${schema.threads.status} = 'open' then 'pending' else ${schema.threads.status} end`,
                lastMessageAt: sql`greatest(${schema.threads.lastMessageAt}, ${sentAt})`,
                firstResponseAt: t!.firstResponseAt ?? sentAt,
                lastAiDraft: null,
                aiDecision: null,
                aiReason: null,
                aiDraftAt: null,
                aiCheck: null,
              })
              .where(eq(schema.threads.id, threadId!));
          }
        });
        n++;
      } catch (e) {
        console.error(`[sent] Gesendet UID ${msg.uid}:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    lock.release();
  }
  if (maxUid > (mb.lastSeenSentUid ?? 0)) {
    await db.update(schema.shopMailboxes).set({ lastSeenSentUid: maxUid }).where(eq(schema.shopMailboxes.id, mb.id));
  }
  return n;
}

export async function ingestMailbox(shop: typeof schema.shops.$inferSelect, mb: MailboxRow): Promise<number> {
  const shadow = mb.shadowMode;
  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: true,
    auth: { user: mb.imapUser, pass: decrypt(mb.imapPasswordEnc) },
    logger: false,
  });
  await client.connect();

  let folders: Folders | null = null;
  try {
    // Schattenbetrieb: KEINE Ordner anlegen/verschieben — Postfach bleibt exakt wie im Webmail.
    if (!shadow) folders = await setupFolders(client);
  } catch (e) {
    console.error(`[folders] ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
  }

  let processed = 0;
  let maxUid = mb.lastSeenUid ?? 0; // höchste ERFOLGREICH verarbeitete UID
  let firstUnhandled: number | null = null; // niedrigste UID, die (noch) nicht ging -> nicht überspringen
  const newUids: number[] = [];
  // Schattenbetrieb: INBOX nur lesend öffnen (EXAMINE) — Server lässt dann gar keine Änderung zu.
  const lock = await client.getMailboxLock("INBOX", { readOnly: shadow });
  try {
    let startUid = (mb.lastSeenUid ?? 0) + 1;
    // Schattenbetrieb, erster Lauf: nur die letzten 14 Tage holen statt des ganzen Posteingangs.
    if (shadow && mb.lastSeenUid == null) {
      const recent = await client.search({ since: new Date(Date.now() - 14 * 86_400_000) }, { uid: true });
      const first = Array.isArray(recent) && recent.length ? Math.min(...recent) : null;
      const uidNext = client.mailbox && typeof client.mailbox === "object" ? Number(client.mailbox.uidNext ?? 1) : 1;
      startUid = first ?? uidNext;
      if (startUid > 1) maxUid = startUid - 1;
    }
    const range = `${startUid}:*`;
    const markUnhandled = (u: number) => {
      if (firstUnhandled === null || u < firstUnhandled) firstUnhandled = u;
    };
    for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
      const uid = msg.uid;
      if (uid <= (mb.lastSeenUid ?? 0)) continue; // schon verarbeitet
      // Kam der Inhalt nicht mit? UID NICHT als gesehen markieren -> nächste Runde erneut (kein Verlust).
      if (!msg.source) {
        markUnhandled(uid);
        continue;
      }
      try {
        const parsed = await simpleParser(msg.source);
        let messageId = parsed.messageId ?? null;
        if (messageId) {
          // Dedup nur INNERHALB des Shops: dieselbe Mail per CC an zwei Shops soll in BEIDEN ankommen.
          const dup = await db
            .select({ shopId: schema.threads.shopId })
            .from(schema.messages)
            .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
            .where(eq(schema.messages.messageId, messageId));
          if (dup.some((d) => d.shopId === shop.id)) {
            maxUid = Math.max(maxUid, uid);
            newUids.push(uid);
            continue;
          }
          // Schon in einem ANDEREN Shop gespeichert -> hier ohne Message-ID speichern (die ist global eindeutig).
          // Doppelt abgeholt wird trotzdem nicht: die IMAP-Position (lastSeenUid) schützt davor.
          if (dup.length) messageId = null;
        }

        const fromAddr = parsed.from?.value?.[0];
        const rawFrom = fromAddr?.address ?? "unknown";
        const replyToAddr = parsed.replyTo?.value?.[0]?.address ?? null;
        // Kontaktformular/Relay (z. B. mailer@shopify.com): echte Kunden-Adresse aus Reply-To/Text ziehen.
        const fromEmail = bestCustomerEmail({
          from: rawFrom,
          replyTo: replyToAddr,
          bodyText: parsed.text ?? null,
          shopAddress: mb.fromEmail,
        });
        const fromName = fromAddr?.name || nameFromBody(parsed.text) || null;
        const subject = parsed.subject ?? null;
      const inReplyTo = parsed.inReplyTo ?? null;
      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];
      const refIds = [inReplyTo, ...references].filter(Boolean) as string[];

      await db.transaction(async (tx) => {
        const threadId = await resolveThreadId(shop.id, mb.id, fromEmail, subject, refIds);
        const insertedMsg = await tx
          .insert(schema.messages)
          .values({
            threadId,
            direction: "inbound",
            fromEmail,
            toEmail: mb.fromEmail,
            subject,
            // HTML-only-Mails: Text aus dem HTML ableiten. Das rohe HTML NICHT speichern
            // (spart massiv DB-Platz — der Klartext genügt für Anzeige und KI).
            bodyText: bestBodyText(parsed.text ?? null, typeof parsed.html === "string" ? parsed.html : null),
            bodyHtml: null,
            messageId,
            inReplyTo,
            imapUid: uid,
            // Schattenbetrieb: kein Ordner merken -> wird nie verschoben (auch nicht nach dem Umstellen).
            imapFolder: shadow ? null : "INBOX",
          })
          .onConflictDoNothing()
          .returning({ id: schema.messages.id });

        // Anhänge (Fotos, PDFs …) mit abspeichern — max. 10 Stück à 8 MB.
        const newMsgDbId = insertedMsg[0]?.id ?? null;
        if (newMsgDbId) {
          // Kundenfotos (z. B. 20 Schadensfotos) vollständig übernehmen: bis 30 Anhänge à 15 MB.
          // Winzige Bilder (Signatur-Logos, Tracking-Pixel) auslassen.
          const atts = (parsed.attachments ?? [])
            .filter((a) => a.content && a.content.length > 0 && a.content.length <= 15 * 1024 * 1024)
            .filter((a) => !(String(a.contentType ?? "").startsWith("image/") && a.content.length < 8 * 1024))
            .slice(0, 30);
          for (const a of atts) {
            await tx.insert(schema.messageAttachment).values({
              messageId: newMsgDbId,
              filename: a.filename || "anhang",
              contentType: a.contentType || "application/octet-stream",
              sizeBytes: a.content.length,
              content: a.content,
            });
          }
        }
        // Kunde antwortet auf Wartet/Erledigt -> Ticket wieder offen (Mail kommt zurück in INBOX).
        await tx
          .update(schema.threads)
          .set({
            lastMessageAt: new Date(),
            status: sql`case when ${schema.threads.status} in ('closed','pending') then 'open' else ${schema.threads.status} end`,
            // Wird ein geschlossenes Ticket wieder geöffnet, ist es nicht mehr "gelöst".
            closedAt: sql`case when ${schema.threads.status} = 'closed' then null else ${schema.threads.closedAt} end`,
            customerName: sql`coalesce(${schema.threads.customerName}, ${fromName})`,
          })
          .where(eq(schema.threads.id, threadId));
      });
        maxUid = Math.max(maxUid, uid);
        newUids.push(uid);
        processed++;
      } catch (e) {
        // Einzelne Mail scheiterte -> NICHT als gesehen markieren, nächste Runde erneut versuchen.
        // Blockiert die anderen Mails nicht (kein "poison message").
        console.error(`[ingest] Mail UID ${uid} übersprungen (nächste Runde erneut):`, e instanceof Error ? e.message : e);
        markUnhandled(uid);
      }
    }

    // Abgeholte Mails als gelesen markieren (kein ungelesener Wust).
    if (newUids.length && !shadow) {
      try {
        await client.messageFlagsAdd(newUids.join(","), ["\\Seen"], { uid: true });
      } catch {
        /* egal */
      }
    }
  } finally {
    lock.release();
  }

  // NIE über eine nicht-verarbeitete UID hinaus vormerken -> solche Mails werden erneut abgeholt.
  const newLastSeen = firstUnhandled !== null ? Math.min(maxUid, firstUnhandled - 1) : maxUid;
  if (newLastSeen > (mb.lastSeenUid ?? 0)) {
    await db
      .update(schema.shopMailboxes)
      .set({ lastSeenUid: newLastSeen, updatedAt: new Date() })
      .where(eq(schema.shopMailboxes.id, mb.id));
  }

  // Antworten aus dem Webmail übernehmen (vor dem Spiegeln, damit beantwortete Mails gleich nach „Wartet“ wandern).
  if (folders) {
    try {
      const n = await ingestSent(client, shop, mb, folders.sent, "live");
      if (n) console.log(`[sent] ${mb.fromEmail}: ${n} Webmail-Antwort(en) ins Tool übernommen.`);
    } catch (e) {
      console.error(`[sent] Webmail ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
    }
  }

  // Ordner spiegeln + Sent-Kopien — best effort, darf den Abruf nie brechen.
  if (folders) {
    try {
      await reconcileFolders(client, mb, folders);
    } catch (e) {
      console.error(`[reconcile] ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
    }
    try {
      await appendSent(client, mb, folders);
    } catch (e) {
      console.error(`[sent] ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
    }
  }

  // Schattenbetrieb: echte Antworten aus dem Webmail mitlesen + mit KI-Entwurf vergleichen.
  if (shadow) {
    try {
      const sentPath = await findSentReadOnly(client);
      if (sentPath) {
        const n = await ingestSent(client, shop, mb, sentPath, "shadow");
        if (n) console.log(`[shadow] ${mb.fromEmail}: ${n} Webmail-Antwort(en) übernommen + verglichen.`);
      } else console.error(`[shadow] ${mb.fromEmail}: Gesendet-Ordner nicht gefunden.`);
    } catch (e) {
      console.error(`[shadow] ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
    }
  }

  await client.logout();
  return processed;
}

export async function ingestAll(onlyShopIds?: string[]): Promise<number> {
  let total = 0;
  const shops = (await db.select().from(schema.shops).where(eq(schema.shops.active, true))).filter(
    (s) => !onlyShopIds || onlyShopIds.includes(s.id),
  );
  for (const shop of shops) {
    const mailboxes = await db
      .select()
      .from(schema.shopMailboxes)
      .where(eq(schema.shopMailboxes.shopId, shop.id));
    for (const mb of mailboxes) {
      try {
        total += await ingestMailbox(shop, mb);
      } catch (err) {
        console.error(`[ingest] Shop ${shop.slug} / ${mb.fromEmail} Fehler:`, err);
      }
    }
  }
  return total;
}
