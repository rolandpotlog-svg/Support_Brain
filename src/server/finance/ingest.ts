// Finance-Ingest: Bestellungen aus Shopify ziehen, COGS (Name-Mapping) + Woche
// berechnen und speichern. Line-Items werden je Order ersetzt (idempotent).
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getOrdersInRange } from "@/lib/shopify/client";
import { cogsForLineItem } from "@/lib/finance/cogs";
import { weekOf } from "@/lib/finance/week";

function toCents(amount: string | null | undefined): number {
  return amount ? Math.round(parseFloat(amount) * 100) : 0;
}

export async function ingestShopifyOrders(
  shopId: string,
  sinceDate: string,
  untilDate: string,
): Promise<{ count: number; unmapped: number }> {
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Brand nicht verbunden");
  const orders = await getOrdersInRange(creds, sinceDate, untilDate);

  let unmapped = 0;
  for (const o of orders) {
    const subtotal = toCents(o.subtotal);
    const discounts = toCents(o.discounts);
    const week = weekOf(new Date(o.createdAt));

    let cogs = 0;
    let unknownOrder = false;
    const items = o.lineItems.map((li) => {
      const c = cogsForLineItem(li.title, li.quantity);
      cogs += c.lineCents;
      if (!c.mapped) unknownOrder = true;
      return { li, c };
    });
    if (unknownOrder) unmapped++;

    const vals = {
      orderGid: o.gid,
      createdAt: new Date(o.createdAt),
      weekStart: week.weekStart,
      umsatzBruttoCents: subtotal + discounts, // "vor Rabatt" (Shopify-Subtotal ist netto-rabattiert)
      rabatteCents: discounts,
      refundsCents: toCents(o.refunded),
      versandEinnahmeCents: toCents(o.shipping),
      ustCents: toCents(o.tax),
      totalCents: toCents(o.total),
      cogsCents: cogs,
      cogsUnknown: unknownOrder,
      financialStatus: o.financialStatus,
      ingestedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.financeOrder)
      .values({ shopId, orderName: o.name, ...vals })
      .onConflictDoUpdate({ target: [schema.financeOrder.shopId, schema.financeOrder.orderName], set: vals })
      .returning({ id: schema.financeOrder.id });

    await db.delete(schema.financeOrderItem).where(eq(schema.financeOrderItem.orderId, row.id));
    if (items.length) {
      await db.insert(schema.financeOrderItem).values(
        items.map(({ li, c }) => ({
          orderId: row.id,
          shopId,
          title: li.title,
          quantity: li.quantity,
          sku: li.sku,
          unitCogsCents: c.unitCents,
          lineCogsCents: c.lineCents,
          mapped: c.mapped,
        })),
      );
    }
  }
  return { count: orders.length, unmapped };
}
