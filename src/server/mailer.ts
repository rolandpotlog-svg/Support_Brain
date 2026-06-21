// Direkter SMTP-Versand über das Postfach eines Shops (für System-Mails wie den
// Wochenbericht — NICHT für Kundenantworten, die laufen über die Outbox).
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";

export async function sendMailViaShop(
  shopId: string,
  msg: { to: string | string[]; subject: string; text: string; html?: string },
): Promise<void> {
  const mb = await db.query.shopMailboxes.findFirst({
    where: eq(schema.shopMailboxes.shopId, shopId),
  });
  if (!mb) throw new Error("Shop hat keine Postfach-Konfiguration");

  const transport = nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpPort === 465,
    auth: { user: mb.smtpUser, pass: decrypt(mb.smtpPasswordEnc) },
  });

  await transport.sendMail({
    from: mb.fromName ? `${mb.fromName} <${mb.fromEmail}>` : mb.fromEmail,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
