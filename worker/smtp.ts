// SMTP-Versand (raus): vom Menschen freigegebene Outbound-Messages senden.
import nodemailer from "nodemailer";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { decrypt } from "../src/lib/mailbox/crypto";

const MAX_ATTEMPTS = Number(process.env.MAX_SEND_ATTEMPTS ?? 5);

async function sendOne(job: { id: string; messageId: string }): Promise<void> {
  const msg = await db.query.messages.findFirst({
    where: eq(schema.messages.id, job.messageId),
  });
  if (!msg) throw new Error("Message nicht gefunden");
  const thread = await db.query.threads.findFirst({
    where: eq(schema.threads.id, msg.threadId),
  });
  if (!thread) throw new Error("Thread nicht gefunden");
  // Über das Postfach senden, an das das Ticket gerichtet war; sonst erstes Postfach des Shops.
  const mb =
    (thread.mailboxId
      ? await db.query.shopMailboxes.findFirst({
          where: eq(schema.shopMailboxes.id, thread.mailboxId),
        })
      : null) ??
    (await db.query.shopMailboxes.findFirst({
      where: eq(schema.shopMailboxes.shopId, thread.shopId),
    }));
  if (!mb) throw new Error("Shop ohne Postfach-Konfiguration");

  const transport = nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpPort === 465,
    auth: { user: mb.smtpUser, pass: decrypt(mb.smtpPasswordEnc) },
  });

  await transport.sendMail({
    messageId: msg.messageId ?? undefined,
    from: mb.fromName ? `${mb.fromName} <${mb.fromEmail}>` : mb.fromEmail,
    to: msg.toEmail ?? thread.customerEmail,
    subject: msg.subject ?? "",
    text: msg.bodyText ?? "",
    inReplyTo: msg.inReplyTo ?? undefined,
    references: msg.inReplyTo ?? undefined,
  });
}

export async function processOutbox(): Promise<number> {
  const jobs = await db
    .select({ id: schema.outbox.id, messageId: schema.outbox.messageId, attempts: schema.outbox.attempts })
    .from(schema.outbox)
    .where(eq(schema.outbox.status, "pending"))
    .orderBy(asc(schema.outbox.createdAt))
    .limit(50);

  let sent = 0;
  for (const job of jobs) {
    try {
      await sendOne(job);
      await db
        .update(schema.outbox)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(schema.outbox.id, job.id));
      sent++;
    } catch (err) {
      const attempts = job.attempts + 1;
      await db
        .update(schema.outbox)
        .set({
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        })
        .where(eq(schema.outbox.id, job.id));
      console.error(`[smtp] Outbox ${job.id} Fehler (Versuch ${attempts}):`, err);
    }
  }
  return sent;
}
