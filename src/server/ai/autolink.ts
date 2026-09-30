// Bestell-Abgleich im Hintergrund: zu jeder neuen Kundenmail die Bestellung finden, prüfen und am Ticket
// speichern — auch ohne KI-Entwurf (Grundlage für Übersicht rechts + Produktanalyse).
import { and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { linkThreadOrder } from "@/server/order-link";
import { runPool } from "@/server/ai/pool";

const MAX_PER_CYCLE = 60;
let running = false;

export async function autoLinkOrders(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const shops = await db
      .select({ id: schema.shopShopify.shopId })
      .from(schema.shopShopify)
      .innerJoin(schema.shops, eq(schema.shops.id, schema.shopShopify.shopId))
      .where(eq(schema.shops.active, true));
    if (!shops.length) return 0;
    const since = new Date(Date.now() - 72 * 3_600_000);
    const todo = await db
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(
        and(
          inArray(schema.threads.shopId, shops.map((s) => s.id)),
          isNull(schema.threads.deletedAt),
          gte(schema.threads.lastMessageAt, since),
          or(isNull(schema.threads.orderMatchedAt), lt(schema.threads.orderMatchedAt, schema.threads.lastMessageAt)),
        ),
      )
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(MAX_PER_CYCLE);
    let n = 0;
    await runPool(todo, 5, async (t) => {
      try {
        await linkThreadOrder(t.id);
        n++;
      } catch (e) {
        console.error(`[autolink] ${t.id}:`, e instanceof Error ? e.message : e);
      }
    });
    return n;
  } finally {
    running = false;
  }
}
