// Beantwortete Tickets automatisch abhaken: 5 Tage keine Kundenantwort -> „Gelöst“.
// Die Antworten sind so formuliert, dass der Fall damit erledigt ist; schreibt der Kunde doch wieder,
// öffnet der Mail-Abruf das Ticket automatisch neu. Im Postfach wandert die Mail nach „Erledigt“.
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

const DAYS = Number(process.env.AUTO_CLOSE_DAYS ?? 5);

export async function autoCloseAnswered(): Promise<number> {
  const rows = await db
    .update(schema.threads)
    .set({ status: "closed", closedAt: sql`now()` })
    .where(
      and(
        eq(schema.threads.status, "pending"),
        lt(schema.threads.lastMessageAt, new Date(Date.now() - DAYS * 86_400_000)),
      ),
    )
    .returning({ id: schema.threads.id });
  return rows.length;
}
