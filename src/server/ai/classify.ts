// Kern der Ticket-Klassifizierung (ohne Auth) — von der Server-Action UND vom
// Worker (Wochenbericht) genutzt.
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { classifyBatch } from "@/server/ai";
import { CATEGORIES, normalizeCategory, SENTIMENTS } from "@/lib/reports/categories";

const VALID_SENTIMENT = new Set<string>(SENTIMENTS);

export async function classifyShopTickets(
  shopId: string,
  days: number,
): Promise<{ classified: number; remaining: number }> {
  const since = new Date(Date.now() - days * 86_400_000);

  const pending = await db
    .select({ id: schema.threads.id, subject: schema.threads.subject })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        gte(schema.threads.createdAt, since),
        isNull(schema.threads.aiClassifiedAt),
      ),
    )
    .orderBy(desc(schema.threads.createdAt))
    .limit(120);

  if (!pending.length) return { classified: 0, remaining: 0 };

  const ids = pending.map((p) => p.id);
  const inbound = await db
    .select({ threadId: schema.messages.threadId, body: schema.messages.bodyText })
    .from(schema.messages)
    .where(and(inArray(schema.messages.threadId, ids), eq(schema.messages.direction, "inbound")))
    .orderBy(asc(schema.messages.createdAt));
  const firstBody = new Map<string, string>();
  for (const m of inbound) if (!firstBody.has(m.threadId) && m.body) firstBody.set(m.threadId, m.body);

  const refMap = new Map<number, string>();
  const items = pending.map((p, i) => {
    refMap.set(i, p.id);
    return {
      ref: i,
      subject: p.subject ?? "",
      body: (firstBody.get(p.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    };
  });

  let classified = 0;
  const now = new Date();
  for (let i = 0; i < items.length; i += 20) {
    const results = await classifyBatch(items.slice(i, i + 20), CATEGORIES, SENTIMENTS);
    for (const r of results) {
      const threadId = refMap.get(r.ref);
      if (!threadId) continue;
      await db
        .update(schema.threads)
        .set({
          aiCategory: normalizeCategory(r.category),
          aiSentiment: VALID_SENTIMENT.has(r.sentiment) ? r.sentiment : "neutral",
          aiProduct: r.product,
          aiClassifiedAt: now,
        })
        .where(eq(schema.threads.id, threadId));
      classified++;
    }
  }

  return { classified, remaining: pending.length - classified };
}
