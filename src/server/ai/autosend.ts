// Automatischer Versand geprüfter KI-Entwürfe. Standard: AUS. Geht nur raus, wenn ALLES stimmt:
// Shop hat Automatik an (und Notaus aus), Anliegen ist freigegeben UND belegt reif, Prüfung bestanden
// ohne Sperre, Tageslimit nicht erreicht. Dann wartet die Antwort im Sicherheitsfenster (Standard 10 Min.),
// in dem ein Mensch sie stoppen kann — und wird direkt vor dem Senden noch einmal geprüft.
import { randomUUID } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { resolveOutbound } from "@/server/outbound";
import { intentReadiness } from "@/server/ai/readiness";
import type { DraftCheck } from "@/server/ai/check";

export async function maybeAutoSend(threadId: string, text: string, check: DraftCheck | undefined): Promise<{ scheduled: boolean; why: string }> {
  const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!t) return { scheduled: false, why: "Ticket fehlt" };
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, t.shopId) });
  if (!shop?.autoSend || shop.killSwitch || !shop.active) return { scheduled: false, why: "Automatik aus" };
  if (!check?.autoEligible) return { scheduled: false, why: "Prüfung/Sperre" };
  const intent = t.aiIntent ?? "sonstiges";
  if (!shop.autoSendIntents.includes(intent)) return { scheduled: false, why: "Anliegen nicht freigegeben" };
  const ready = (await intentReadiness(shop.id)).find((r) => r.intent === intent);
  if (!ready?.ready) return { scheduled: false, why: "Anliegen noch nicht reif" };

  // Tageslimit (Wiener Zeit)
  const today = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(
      and(
        eq(schema.threads.shopId, shop.id),
        eq(schema.messages.aiOutcome, "auto"),
        sql`(${schema.messages.createdAt} at time zone 'Europe/Vienna')::date = (now() at time zone 'Europe/Vienna')::date`,
      ),
    );
  if ((today[0]?.n ?? 0) >= shop.autoSendDailyMax) return { scheduled: false, why: "Tageslimit erreicht" };

  // Schon eine geplante automatische Antwort in diesem Ticket? Dann nicht noch eine.
  if (await pendingAuto(threadId)) return { scheduled: false, why: "schon geplant" };

  const { mailbox, recipient, subject, lastInbound } = await resolveOutbound(t);
  const sendAfter = new Date(Date.now() + Math.max(1, shop.autoSendDelayMin) * 60_000);
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(schema.messages)
      .values({
        threadId,
        direction: "outbound",
        fromEmail: mailbox.fromEmail,
        toEmail: recipient,
        subject,
        bodyText: text,
        messageId: `<${randomUUID().replace(/-/g, "")}@support-brain>`,
        inReplyTo: lastInbound?.messageId ?? null,
        aiOutcome: "auto",
        aiDraft: text,
        aiDecision: "auto",
        aiCheckPassed: true,
        sentBy: null,
      })
      .returning({ id: schema.messages.id });
    await tx.insert(schema.outbox).values({ messageId: msg.id, sendAfter });
  });
  return { scheduled: true, why: `geplant für ${sendAfter.toISOString()}` };
}

/** Geplante, noch nicht gesendete automatische Antwort eines Tickets (für Banner + Stopp). */
export async function pendingAuto(threadId: string): Promise<{ messageId: string; sendAfter: Date | null } | null> {
  const r = await db
    .select({ messageId: schema.messages.id, sendAfter: schema.outbox.sendAfter })
    .from(schema.messages)
    .innerJoin(schema.outbox, eq(schema.outbox.messageId, schema.messages.id))
    .where(and(eq(schema.messages.threadId, threadId), eq(schema.messages.aiOutcome, "auto"), eq(schema.outbox.status, "pending")))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return r[0] ?? null;
}

/** Automatische Antwort stoppen: Text wird wieder zum Entwurf, Ticket bleibt offen, Notiz mit Grund. */
export async function cancelAuto(messageId: string, reason: string): Promise<boolean> {
  const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!m || m.aiOutcome !== "auto") return false;
  const box = await db.query.outbox.findFirst({ where: eq(schema.outbox.messageId, messageId) });
  if (!box || box.status !== "pending") return false;
  // Nur stoppen, wenn gerade niemand sendet (gleiche Sperre wie beim Senden)
  const del = await db
    .delete(schema.outbox)
    .where(and(eq(schema.outbox.id, box.id), eq(schema.outbox.status, "pending"), sql`(${schema.outbox.claimedAt} is null or ${schema.outbox.claimedAt} < now() - interval '5 minutes')`))
    .returning({ id: schema.outbox.id });
  if (!del.length) return false;
  await db.delete(schema.messages).where(eq(schema.messages.id, messageId));
  await db
    .update(schema.threads)
    .set({ lastAiDraft: m.bodyText, aiDraftAt: sql`now()`, aiDecision: "mensch", aiReason: `Automatik gestoppt: ${reason}` })
    .where(eq(schema.threads.id, m.threadId));
  await db.insert(schema.messages).values({
    threadId: m.threadId,
    direction: "outbound",
    internal: true,
    fromEmail: "system",
    bodyText: `🤖 Automatische Antwort gestoppt: ${reason}. Der Text liegt als Entwurf bereit.`,
  });
  return true;
}

/** Direkt vor dem Senden: gilt die automatische Antwort noch? Sonst stoppen. */
export async function autoStillValid(messageId: string): Promise<boolean> {
  const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!m) return false;
  const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, m.threadId) });
  const shop = t ? await db.query.shops.findFirst({ where: eq(schema.shops.id, t.shopId) }) : null;
  let reason = "";
  if (!t || t.deletedAt || t.status === "spam") reason = "Ticket gelöscht/Spam";
  else if (!shop?.autoSend || shop.killSwitch) reason = "Automatik wurde ausgeschaltet";
  else {
    const newer = await db
      .select({ id: schema.messages.id, direction: schema.messages.direction })
      .from(schema.messages)
      // Vergleich IN der Datenbank (µs) und die Nachricht selbst ausschließen — JS-Dates haben nur ms.
      .where(
        and(
          eq(schema.messages.threadId, m.threadId),
          eq(schema.messages.internal, false),
          ne(schema.messages.id, m.id),
          sql`${schema.messages.createdAt} > (select m2.created_at from messages m2 where m2.id = ${m.id})`,
        ),
      );
    if (newer.some((x) => x.direction === "inbound")) reason = "Kunde hat inzwischen neu geschrieben";
    else if (newer.some((x) => x.direction === "outbound")) reason = "Es wurde inzwischen anders geantwortet";
  }
  if (!reason) return true;
  await cancelAuto(messageId, reason);
  return false;
}

/** Nach erfolgreichem automatischen Versand: Ticket wie nach einer normalen Antwort weiterschalten. */
export async function afterAutoSent(messageId: string): Promise<void> {
  const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!m) return;
  const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, m.threadId) });
  await db
    .update(schema.threads)
    .set({
      status: "pending",
      lastMessageAt: new Date(),
      firstResponseAt: t?.firstResponseAt ?? new Date(),
      lastAiDraft: null,
      aiDecision: null,
      aiReason: null,
      aiDraftAt: null,
      aiCheck: null,
    })
    .where(eq(schema.threads.id, m.threadId));
}
