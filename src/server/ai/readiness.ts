// Automatik-Reife je Anliegen (Rolands Regel): in den letzten 30 Tagen ≥ 30 KI-Entwürfe UNVERÄNDERT von
// Menschen gesendet und ≥ 90 % unverändert. Automatisch gesendete Antworten zählen nicht mit.
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export const READY_MIN = 30;
export const READY_PCT = 90;

export type IntentReadiness = { intent: string; verbatim: number; edited: number; pct: number | null; ready: boolean };

export async function intentReadiness(shopId: string): Promise<IntentReadiness[]> {
  const rows = await db
    .select({ intent: schema.threads.aiIntent, outcome: schema.messages.aiOutcome, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        eq(schema.messages.direction, "outbound"),
        isNotNull(schema.messages.aiDraft),
        inArray(schema.messages.aiOutcome, ["verbatim", "edited"]),
        gte(schema.messages.createdAt, new Date(Date.now() - 30 * 86_400_000)),
      ),
    )
    .groupBy(schema.threads.aiIntent, schema.messages.aiOutcome);
  const keys = [...new Set(rows.map((r) => r.intent ?? "sonstiges"))];
  return keys
    .map((intent) => {
      const verbatim = rows.filter((r) => (r.intent ?? "sonstiges") === intent && r.outcome === "verbatim").reduce((a, r) => a + r.n, 0);
      const edited = rows.filter((r) => (r.intent ?? "sonstiges") === intent && r.outcome === "edited").reduce((a, r) => a + r.n, 0);
      const pct = verbatim + edited ? Math.round((verbatim / (verbatim + edited)) * 100) : null;
      return { intent, verbatim, edited, pct, ready: verbatim >= READY_MIN && (pct ?? 0) >= READY_PCT };
    })
    .sort((a, b) => b.verbatim + b.edited - (a.verbatim + a.edited));
}
