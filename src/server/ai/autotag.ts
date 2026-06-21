// Auto-Tagging: neue Tickets von Auto-Tag-Shops beim Eingang klassifizieren und
// taggen (Tag nur setzen, wenn noch keiner gesetzt ist -> manuelle Tags bleiben).
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured, classifyBatch } from "@/server/ai";
import { CATEGORIES, normalizeCategory, SENTIMENTS } from "@/lib/reports/categories";

const VALID_SENTIMENT = new Set<string>(SENTIMENTS);

export async function autoTagRecent(): Promise<number> {
  if (!aiConfigured()) return 0;
  const shops = await db
    .select({ id: schema.shops.id })
    .from(schema.shops)
    .where(and(eq(schema.shops.autoTag, true), eq(schema.shops.active, true)));
  if (!shops.length) return 0;

  const since = new Date(Date.now() - 3 * 86_400_000); // nur frische Tickets, kein Alt-Backlog
  let tagged = 0;

  for (const s of shops) {
    // Backfill: bereits klassifizierte Tickets ohne Tag bekommen die KI-Kategorie als Tag
    // (kein KI-Aufruf nötig). Greift z. B. bei Tickets, die zuvor im Report klassifiziert wurden.
    await db
      .update(schema.threads)
      .set({ tag: sql`${schema.threads.aiCategory}` })
      .where(
        and(
          eq(schema.threads.shopId, s.id),
          isNull(schema.threads.tag),
          isNotNull(schema.threads.aiCategory),
        ),
      );

    const pending = await db
      .select({ id: schema.threads.id, subject: schema.threads.subject, tag: schema.threads.tag })
      .from(schema.threads)
      .where(
        and(
          eq(schema.threads.shopId, s.id),
          isNull(schema.threads.aiClassifiedAt),
          gte(schema.threads.createdAt, since),
        ),
      )
      .orderBy(desc(schema.threads.createdAt))
      .limit(30);
    if (!pending.length) continue;

    const ids = pending.map((p) => p.id);
    const inbound = await db
      .select({ threadId: schema.messages.threadId, body: schema.messages.bodyText })
      .from(schema.messages)
      .where(and(inArray(schema.messages.threadId, ids), eq(schema.messages.direction, "inbound")))
      .orderBy(asc(schema.messages.createdAt));
    const firstBody = new Map<string, string>();
    for (const m of inbound) if (!firstBody.has(m.threadId) && m.body) firstBody.set(m.threadId, m.body);

    const refMap = new Map<number, { id: string; tag: string | null }>();
    const items = pending.map((p, i) => {
      refMap.set(i, { id: p.id, tag: p.tag });
      return {
        ref: i,
        subject: p.subject ?? "",
        body: (firstBody.get(p.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
      };
    });

    const now = new Date();
    for (let i = 0; i < items.length; i += 20) {
      const results = await classifyBatch(items.slice(i, i + 20), CATEGORIES, SENTIMENTS);
      for (const r of results) {
        const t = refMap.get(r.ref);
        if (!t) continue;
        const category = normalizeCategory(r.category);
        await db
          .update(schema.threads)
          .set({
            aiCategory: category,
            aiSentiment: VALID_SENTIMENT.has(r.sentiment) ? r.sentiment : "neutral",
            aiProduct: r.product,
            aiClassifiedAt: now,
            tag: t.tag ?? category, // vorhandenen (manuellen) Tag nie überschreiben
          })
          .where(eq(schema.threads.id, t.id));
        tagged++;
      }
    }
  }
  return tagged;
}
