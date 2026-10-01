// SMTP-Versand (raus): freigegebene Outbound-Messages senden.
// Nutzt dasselbe Sende-Modul wie die Server-Action (src/server/send.ts) — keine Doppel-Logik.
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { sendOutboxMessage } from "../src/server/send";

export async function processOutbox(): Promise<number> {
  const jobs = await db
    .select({ messageId: schema.outbox.messageId })
    .from(schema.outbox)
    // geplante automatische Antworten erst nach Ablauf des Sicherheitsfensters
    .where(and(eq(schema.outbox.status, "pending"), or(isNull(schema.outbox.sendAfter), lte(schema.outbox.sendAfter, new Date()))))
    .orderBy(asc(schema.outbox.createdAt))
    .limit(50);

  let sent = 0;
  for (const job of jobs) {
    const r = await sendOutboxMessage(job.messageId);
    if (r.ok) sent++;
  }
  return sent;
}
