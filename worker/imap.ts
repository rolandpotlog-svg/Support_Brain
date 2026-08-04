// IMAP-Ingest + Ordner-Spiegelung. Der Server-Posteingang (INBOX) enthält nur offene
// Fälle; Bearbeitetes wandert in Wartet/Erledigt, Gesendetes wird in Gesendet abgelegt.
// Quelle der Wahrheit ist der Ticket-Status im Tool. NIEMALS löschen — nur verschieben.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { decrypt } from "../src/lib/mailbox/crypto";
import { bestBodyText } from "../src/lib/mailbox/html-text";

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

async function ingestMailbox(shop: typeof schema.shops.$inferSelect, mb: MailboxRow): Promise<number> {
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
    folders = await setupFolders(client);
  } catch (e) {
    console.error(`[folders] ${mb.fromEmail}:`, e instanceof Error ? e.message : e);
  }

  let processed = 0;
  let maxUid = mb.lastSeenUid ?? 0; // höchste ERFOLGREICH verarbeitete UID
  let firstUnhandled: number | null = null; // niedrigste UID, die (noch) nicht ging -> nicht überspringen
  const newUids: number[] = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const range = `${(mb.lastSeenUid ?? 0) + 1}:*`;
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
        const messageId = parsed.messageId ?? null;
        if (messageId) {
          const dup = await db.query.messages.findFirst({ where: eq(schema.messages.messageId, messageId) });
          if (dup) {
            maxUid = Math.max(maxUid, uid);
            newUids.push(uid);
            continue;
          }
        }

        const fromAddr = parsed.from?.value?.[0];
      const fromEmail = fromAddr?.address ?? "unknown";
      const fromName = fromAddr?.name || null;
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
            imapFolder: "INBOX",
          })
          .onConflictDoNothing()
          .returning({ id: schema.messages.id });

        // Anhänge (Fotos, PDFs …) mit abspeichern — max. 10 Stück à 8 MB.
        const newMsgDbId = insertedMsg[0]?.id ?? null;
        if (newMsgDbId) {
          const atts = (parsed.attachments ?? [])
            .filter((a) => a.content && a.content.length > 0 && a.content.length <= 5 * 1024 * 1024)
            .slice(0, 5);
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
    if (newUids.length) {
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

  await client.logout();
  return processed;
}

export async function ingestAll(): Promise<number> {
  let total = 0;
  const shops = await db.select().from(schema.shops).where(eq(schema.shops.active, true));
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
