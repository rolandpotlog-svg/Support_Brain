// Gemeinsames SMTP-Sende-Modul — nutzbar aus dem Worker UND direkt aus der Server-Action
// (damit eine freigegebene Antwort SOFORT rausgeht statt bis zu 60 s in der Warteschlange zu warten).
import nodemailer from "nodemailer";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";

const MAX_ATTEMPTS = Number(process.env.MAX_SEND_ATTEMPTS ?? 5);

async function deliver(messageId: string): Promise<void> {
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg) throw new Error("Message nicht gefunden");
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, msg.threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");
  // Über das Postfach senden, an das das Ticket gerichtet war; sonst erstes Postfach des Shops.
  const mb =
    (thread.mailboxId
      ? await db.query.shopMailboxes.findFirst({ where: eq(schema.shopMailboxes.id, thread.mailboxId) })
      : null) ??
    (await db.query.shopMailboxes.findFirst({ where: eq(schema.shopMailboxes.shopId, thread.shopId) }));
  if (!mb) throw new Error("Shop ohne Postfach-Konfiguration");

  // Anhänge der Nachricht mitsenden (Fotos, PDFs …).
  const atts = await db
    .select({
      filename: schema.messageAttachment.filename,
      contentType: schema.messageAttachment.contentType,
      content: schema.messageAttachment.content,
    })
    .from(schema.messageAttachment)
    .where(eq(schema.messageAttachment.messageId, messageId));

  const transport = nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpPort === 465,
    auth: { user: mb.smtpUser, pass: decrypt(mb.smtpPasswordEnc) },
    // Timeouts: hängt der Server, blockiert die Antwort nicht ewig — Worker versucht es später erneut.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({
      messageId: msg.messageId ?? undefined,
      from: mb.fromName ? `${mb.fromName} <${mb.fromEmail}>` : mb.fromEmail,
      to: msg.toEmail ?? thread.customerEmail,
      subject: msg.subject ?? "",
      text: msg.bodyText ?? "",
      inReplyTo: msg.inReplyTo ?? undefined,
      references: msg.inReplyTo ?? undefined,
      attachments: atts.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
  } finally {
    transport.close();
  }
}

/**
 * Sendet die zu einer Message gehörende Outbox-Zeile per SMTP und aktualisiert deren Status.
 * Idempotent (bereits gesendet -> ok). Fehler -> Zähler hoch, bleibt pending (Worker retryt) bzw. failed.
 */
export async function sendOutboxMessage(messageId: string): Promise<{ ok: boolean; error?: string }> {
  const box = await db.query.outbox.findFirst({ where: eq(schema.outbox.messageId, messageId) });
  if (!box) return { ok: false, error: "Keine Outbox-Zeile" };
  if (box.status === "sent") return { ok: true };

  // Atomar „beanspruchen“: nur EIN Aufrufer (Senden-Knopf oder Worker) darf diese Zeile senden.
  // Eine hängengebliebene Sperre verfällt nach 5 Minuten (z. B. Prozess abgestürzt).
  const claimed = await db
    .update(schema.outbox)
    .set({ claimedAt: new Date() })
    .where(
      and(
        eq(schema.outbox.id, box.id),
        eq(schema.outbox.status, "pending"),
        or(isNull(schema.outbox.claimedAt), lt(schema.outbox.claimedAt, new Date(Date.now() - 5 * 60_000))),
      ),
    )
    .returning({ id: schema.outbox.id });
  if (!claimed.length) return { ok: false, error: "wird bereits gesendet" };

  try {
    await deliver(messageId);
    await db.update(schema.outbox).set({ status: "sent", sentAt: new Date(), claimedAt: null }).where(eq(schema.outbox.id, box.id));
    return { ok: true };
  } catch (err) {
    const attempts = box.attempts + 1;
    const errMsg = err instanceof Error ? err.message : String(err);
    const failed = attempts >= MAX_ATTEMPTS;
    await db
      .update(schema.outbox)
      .set({ attempts, lastError: errMsg, status: failed ? "failed" : "pending", claimedAt: null })
      .where(eq(schema.outbox.id, box.id));
    console.error(`[send] Outbox ${box.id} Fehler (Versuch ${attempts}):`, errMsg);
    if (failed) await onFinalFailure(messageId, attempts, errMsg);
    return { ok: false, error: errMsg };
  }
}

/** Endgültig fehlgeschlagen: Ticket wieder sichtbar machen + interne Notiz mit Grund. */
async function onFinalFailure(messageId: string, attempts: number, errMsg: string): Promise<void> {
  try {
    const m = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
    if (!m) return;
    await db.insert(schema.messages).values({
      threadId: m.threadId,
      direction: "outbound",
      internal: true,
      fromEmail: "system",
      bodyText: `⚠ Zustellung fehlgeschlagen nach ${attempts} Versuchen: ${errMsg}. Bitte Empfaenger/Postfach pruefen und erneut senden.`,
    });
    await db
      .update(schema.threads)
      .set({
        status: sql`case when ${schema.threads.status} in ('escalated','spam') then ${schema.threads.status} else 'open' end`,
        lastMessageAt: new Date(),
      })
      .where(eq(schema.threads.id, m.threadId));
  } catch (e) {
    console.error("[send] Fehler-Notiz:", e instanceof Error ? e.message : e);
  }
}
