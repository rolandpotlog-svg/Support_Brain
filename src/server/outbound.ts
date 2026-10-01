// Gemeinsam für „Senden“-Knopf und automatischen Versand: über welches Postfach, an wen, mit welchem Betreff.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { emailFromBody, isRelayAddress } from "@/lib/mailbox/extract";

type ThreadRow = typeof schema.threads.$inferSelect;

export async function resolveOutbound(t: ThreadRow) {
  // Antwort geht über das Postfach des Tickets raus (Fallback: erstes Postfach des Shops).
  const mailbox =
    (t.mailboxId
      ? await db.query.shopMailboxes.findFirst({
          where: eq(schema.shopMailboxes.id, t.mailboxId),
        })
      : null) ??
    (await db.query.shopMailboxes.findFirst({
      where: eq(schema.shopMailboxes.shopId, t.shopId),
    }));
  if (!mailbox) throw new Error("Shop hat keine Postfach-Konfiguration");
  // Schattenbetrieb: das Team antwortet im Webmail — aus dem Tool wird nichts gesendet (kein Doppel-Versand).
  if (mailbox.shadowMode) {
    throw new Error("Schattenbetrieb aktiv: Bitte im Webmail antworten. Das Tool liest die Antwort automatisch mit und vergleicht sie mit dem KI-Entwurf.");
  }

  const lastInbound = await db.query.messages.findFirst({
    where: and(eq(schema.messages.threadId, t.id), eq(schema.messages.direction, "inbound")),
    orderBy: desc(schema.messages.createdAt),
  });

  // Empfänger bestimmen. Bei Kontaktformular-/Relay-Adressen (z. B. mailer@shopify.com) den echten
  // Kunden aus der ersten eingehenden Nachricht ziehen — sonst ginge die Antwort an das Relay.
  let recipient = t.customerEmail;
  if (isRelayAddress(recipient)) {
    const firstInbound = await db.query.messages.findFirst({
      where: and(eq(schema.messages.threadId, t.id), eq(schema.messages.direction, "inbound")),
      orderBy: schema.messages.createdAt,
    });
    const real = emailFromBody(firstInbound?.bodyText ?? null, mailbox.fromEmail);
    if (real) recipient = real;
  }

  const subject = (t.subject ?? "").toLowerCase().startsWith("re:") ? t.subject : `Re: ${t.subject ?? ""}`.trim();
  return { mailbox, recipient, subject, lastInbound };
}
