"use server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/server/db";
import { assertShopAccess, assignableUsers, requireUser, requireWrite } from "@/server/access";
import { ACTIVE_SHOP_COOKIE, ACTIVE_SHOP_COOKIE_OPTS } from "@/server/active-shop";
import { sendOutboxMessage } from "@/server/send";
import { resolveOutbound } from "@/server/outbound";
import { cancelAuto, pendingAuto } from "@/server/ai/autosend";

/** Aktiven Shop wechseln (vom Shop-Umschalter aufgerufen). */
export async function setActiveShop(shopId: string, redirectTo: string = "/inbox") {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const store = await cookies();
  store.set(ACTIVE_SHOP_COOKIE, shopId, ACTIVE_SHOP_COOKIE_OPTS);
  redirect(redirectTo);
}

/** Aktiven Shop global setzen (Sidebar-Umschalter) — ohne Redirect; Client macht router.refresh(). */
export async function selectActiveShop(shopId: string) {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const store = await cookies();
  store.set(ACTIVE_SHOP_COOKIE, shopId, ACTIVE_SHOP_COOKIE_OPTS);
}

async function loadThread(threadId: string) {
  const t = await db.query.threads.findFirst({
    where: eq(schema.threads.id, threadId),
  });
  if (!t) throw new Error("Thread nicht gefunden");
  return t;
}

export async function assignThread(threadId: string, assigneeId: string | null) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  // Nur Personen zuweisen, die zu DIESEM Shop gehören.
  if (assigneeId && !(await assignableUsers(t.shopId)).some((u) => u.id === assigneeId)) {
    throw new Error("Diese Person gehört nicht zu diesem Shop.");
  }
  await db
    .update(schema.threads)
    .set({ assigneeId })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

export async function setThreadTag(threadId: string, tag: string | null) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({ tag: tag && tag.trim() ? tag.trim() : null })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

/** Interne Notiz am Ticket (nicht an den Kunden, wird nie versendet). */
export async function addNote(threadId: string, bodyText: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  if (!bodyText.trim()) throw new Error("Leere Notiz");
  await db.insert(schema.messages).values({
    threadId,
    direction: "outbound",
    internal: true,
    fromEmail: user.email,
    bodyText,
    sentBy: user.id,
  });
  revalidatePath("/inbox");
}

export async function setThreadStatus(threadId: string, status: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({
      status: status as "open" | "pending" | "escalated" | "closed",
      // Lösungszeit-Tracking: beim Schließen Zeitstempel setzen, beim Wieder-Öffnen löschen.
      closedAt: status === "closed" ? new Date() : null,
    })
    .where(eq(schema.threads.id, threadId));
  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

export async function escalateThread(threadId: string, reason: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.threads)
      .set({ status: "escalated" })
      .where(eq(schema.threads.id, threadId));
    await tx.insert(schema.escalations).values({
      threadId,
      raisedBy: user.id,
      reason: reason || null,
    });
  });
  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
  revalidatePath("/admin");
}

/** Draft-First: vom Menschen freigegebene Antwort -> Outbound-Message + Outbox-Job. */
/** Antwort senden. Gibt Fehler als Text zurück (statt zu werfen), damit der Mitarbeiter die echte
 *  Meldung sieht — Next.js blendet geworfene Fehlertexte im Live-Betrieb aus. */
export async function replyToThread(
  threadId: string,
  bodyText: string,
  filesForm?: FormData,
  seenMessageId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await replyToThreadInner(threadId, bodyText, filesForm, seenMessageId);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reply]", threadId, msg);
    return { ok: false, error: msg };
  }
}

async function replyToThreadInner(threadId: string, bodyText: string, filesForm?: FormData, seenMessageId?: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  if (!bodyText.trim()) throw new Error("Leere Antwort");

  // Liegt eine automatische Antwort im Sicherheitsfenster? Der Mensch hat Vorrang — Automatik stoppen.
  const auto = await pendingAuto(threadId);
  if (auto && !(await cancelAuto(auto.messageId, "Mitarbeiter antwortet selbst"))) {
    throw new Error("Die automatische Antwort wird gerade gesendet — bitte Seite neu laden, bevor du antwortest.");
  }

  // Doppel-Schutz: Ist seit dem Öffnen etwas Neues passiert, NICHT senden.
  if (seenMessageId) {
    const seen = await db.query.messages.findFirst({ where: eq(schema.messages.id, seenMessageId) });
    if (seen) {
      const newer = await db
        .select({ direction: schema.messages.direction, sentBy: schema.messages.sentBy, name: schema.users.name, email: schema.users.email })
        .from(schema.messages)
        .leftJoin(schema.users, eq(schema.users.id, schema.messages.sentBy))
        // Vergleich IN der Datenbank (Mikrosekunden) — JS-Dates haben nur Millisekunden, sonst zählt die
        // gesehene Nachricht selbst als „neuer“. Die gesehene Nachricht zusätzlich ausschließen.
        .where(
          and(
            eq(schema.messages.threadId, threadId),
            eq(schema.messages.internal, false),
            ne(schema.messages.id, seen.id),
            sql`${schema.messages.createdAt} > (select m2.created_at from messages m2 where m2.id = ${seen.id})`,
          ),
        );
      const reply = newer.find((m) => m.direction === "outbound");
      if (reply) {
        const who = reply.sentBy === user.id ? "Du hast" : `${reply.name || reply.email || "Jemand"} hat`;
        throw new Error(`${who} inzwischen schon geantwortet — nicht gesendet, damit der Kunde keine doppelte Antwort bekommt. Bitte Seite neu laden.`);
      }
      if (newer.some((m) => m.direction === "inbound")) {
        throw new Error("Der Kunde hat inzwischen neu geschrieben — nicht gesendet. Bitte Seite neu laden und die neue Nachricht berücksichtigen.");
      }
    }
  }

  const { mailbox, recipient, subject, lastInbound } = await resolveOutbound(t);
  const newMsgId = `<${randomUUID().replace(/-/g, "")}@support-brain>`;

  // KI-Entwurf-Nutzung messen: 1:1 übernommen, bearbeitet oder ganz ohne Entwurf.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const aiOutcome = t.lastAiDraft
    ? norm(bodyText) === norm(t.lastAiDraft)
      ? "verbatim"
      : "edited"
    : "manual";

  let createdMessageId: string | null = null;
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(schema.messages)
      .values({
        threadId,
        direction: "outbound",
        fromEmail: mailbox.fromEmail,
        toEmail: recipient,
        subject,
        bodyText,
        messageId: newMsgId,
        inReplyTo: lastInbound?.messageId ?? null,
        aiOutcome,
        aiDraft: t.lastAiDraft ?? null,
        aiDecision: t.lastAiDraft ? t.aiDecision : null,
        // Prüfung bestanden? (nur wenn es zum gesendeten Entwurf ein Prüfergebnis gibt)
        aiCheckPassed: t.lastAiDraft && t.aiCheck ? t.aiCheck.passed : null,
        aiAutoEligible: t.lastAiDraft && t.aiCheck ? t.aiCheck.autoEligible : null,
        sentBy: user.id,
      })
      .returning({ id: schema.messages.id });
    createdMessageId = msg.id;
    await tx.insert(schema.outbox).values({ messageId: msg.id });
    await tx
      .update(schema.threads)
      .set({
        status: "pending",
        lastMessageAt: new Date(),
        // Erste Antwortzeit festhalten (nur beim ersten Mal); Entwurf-Puffer leeren.
        firstResponseAt: t.firstResponseAt ?? new Date(),
        lastAiDraft: null,
        aiDecision: null,
        aiReason: null,
        aiDraftAt: null,
      })
      .where(eq(schema.threads.id, threadId));
  });

  // Anhänge VOR dem Senden speichern, damit sie in der Mail mitgehen (max. 5 × 8 MB).
  if (createdMessageId && filesForm) {
    const files = filesForm.getAll("files").filter((f): f is File => f instanceof File).slice(0, 5);
    for (const f of files) {
      if (f.size <= 0 || f.size > 8 * 1024 * 1024) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      await db.insert(schema.messageAttachment).values({
        messageId: createdMessageId,
        filename: f.name || "anhang",
        contentType: f.type || "application/octet-stream",
        sizeBytes: buf.length,
        content: buf,
      });
    }
  }

  // SOFORT senden (nicht auf den Worker warten). Klappt es, sieht der Mitarbeiter direkt „gesendet".
  // Schlägt SMTP fehl, bleibt die Zeile in der Warteschlange und der Worker versucht es erneut.
  if (createdMessageId) {
    try {
      await sendOutboxMessage(createdMessageId);
    } catch {
      /* egal — Worker übernimmt den Retry */
    }
  }

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

/** Hängende/fehlgeschlagene Antwort sofort erneut senden (nicht nur neu einreihen). */
export async function retrySend(messageId: string) {
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg) throw new Error("Nachricht nicht gefunden");
  const t = await loadThread(msg.threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.outbox)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(eq(schema.outbox.messageId, messageId));
  // Direkt zustellen, damit der Mitarbeiter sofort das Ergebnis sieht.
  try {
    await sendOutboxMessage(messageId);
  } catch {
    /* egal — Worker übernimmt den Retry */
  }
  revalidatePath("/inbox");
}

/** Ticket in den Papierkorb legen. Beim nächsten Worker-Lauf wandert die Mail in den Trash-Ordner. */
export async function deleteThread(threadId: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db.update(schema.threads).set({ deletedAt: new Date() }).where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

/** Ticket aus dem Papierkorb wiederherstellen (zurueck in den Posteingang). */
export async function restoreThread(threadId: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({ deletedAt: null, status: "open" })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

/** Kollisionsschutz: „ich habe dieses Ticket offen (und tippe ggf.)“ melden + wer sonst gerade dran ist. */
export async function touchPresence(threadId: string, typing: boolean): Promise<{ name: string; typing: boolean }[]> {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await assertShopAccess(user, t.shopId);
  await db
    .insert(schema.ticketPresence)
    .values({ threadId, userId: user.id, typing, seenAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.ticketPresence.threadId, schema.ticketPresence.userId],
      set: { typing, seenAt: new Date() },
    });
  const others = await db
    .select({ name: schema.users.name, email: schema.users.email, typing: schema.ticketPresence.typing })
    .from(schema.ticketPresence)
    .innerJoin(schema.users, eq(schema.users.id, schema.ticketPresence.userId))
    .where(
      and(
        eq(schema.ticketPresence.threadId, threadId),
        ne(schema.ticketPresence.userId, user.id),
        gt(schema.ticketPresence.seenAt, new Date(Date.now() - 45_000)),
      ),
    );
  return others.map((o) => ({ name: o.name || o.email, typing: o.typing }));
}

/** Geplante automatische Antwort stoppen (Text wird wieder zum Entwurf). */
export async function stopAutoSend(messageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!m) return { ok: false, error: "Nachricht nicht gefunden" };
    const t = await loadThread(m.threadId);
    await requireWrite(t.shopId, "support");
    const ok = await cancelAuto(messageId, `gestoppt von ${user.email}`);
    revalidatePath("/inbox");
    return ok ? { ok: true } : { ok: false, error: "Schon gesendet oder bereits gestoppt." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Geplante automatische Antwort sofort senden (Sicherheitsfenster überspringen). */
export async function sendAutoNow(messageId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!m || m.aiOutcome !== "auto") return { ok: false, error: "Nachricht nicht gefunden" };
    const t = await loadThread(m.threadId);
    await requireWrite(t.shopId, "support");
    await db.update(schema.outbox).set({ sendAfter: null }).where(and(eq(schema.outbox.messageId, messageId), eq(schema.outbox.status, "pending")));
    const r = await sendOutboxMessage(messageId);
    revalidatePath("/inbox");
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
