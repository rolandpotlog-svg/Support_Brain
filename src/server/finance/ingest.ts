// Finance-Ingest: Bestellungen aus Shopify ziehen, COGS (Name-Mapping) + Woche
// berechnen und speichern. Line-Items werden je Order ersetzt (idempotent).
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getOrdersInRange, getRefundsInRange } from "@/lib/shopify/client";
import { cogsForLineItem, cogsFromProductTable } from "@/lib/finance/cogs";
import { getCogsRates, getProductCostMap, shopUsesRules } from "@/server/finance/cogs-rates";
import { weekOf } from "@/lib/finance/week";

export async function ingestShopifyOrders(
  shopId: string,
  sinceDate: string,
  untilDate: string,
): Promise<{ count: number; unmapped: number }> {
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Brand nicht verbunden");
  const orders = await getOrdersInRange(creds, sinceDate, untilDate);
  const rates = await getCogsRates(shopId);
  // Repello: feste Regel-Engine. Andere Shops (z. B. Lovenja): Einkaufspreis je Produkt aus der Tabelle.
  const rules = await shopUsesRules(shopId);
  const productCosts = rules ? null : await getProductCostMap(shopId);

  let unmapped = 0;
  for (const o of orders) {
    const week = weekOf(new Date(o.createdAt));

    let cogs = 0;
    let unknownOrder = false;
    const items = o.lineItems.map((li) => {
      const c = productCosts ? cogsFromProductTable(li.title, li.quantity, productCosts) : cogsForLineItem(li.title, li.quantity, rates);
      cogs += c.lineCents;
      if (!c.mapped) unknownOrder = true;
      return { li, c };
    });
    if (unknownOrder) unmapped++;

    const vals = {
      orderGid: o.gid,
      createdAt: new Date(o.createdAt),
      weekStart: week.weekStart,
      umsatzBruttoCents: o.grossExCents, // Gross sales ex-USt (Shopify-Report-Logik)
      rabatteCents: o.discountsExCents,
      refundsCents: o.refundedCents, // Referenz; Wochen-Refunds via finance_refund
      versandEinnahmeCents: o.shippingExCents,
      ustCents: o.taxCents,
      totalCents: o.totalCents,
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

/** Refunds nach Erstattungs-Datum holen (Shopify-Report-Logik) und je Erstattungs-Woche speichern. */
export async function ingestRefunds(shopId: string, sinceDate: string, untilDate: string): Promise<{ count: number; totalCents: number }> {
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Brand nicht verbunden");
  const refunds = await getRefundsInRange(creds, sinceDate, untilDate);
  let totalCents = 0;
  for (const r of refunds) {
    totalCents += r.amountCents;
    const refundWeek = weekOf(new Date(`${r.createdAt}T12:00:00Z`)).weekStart;
    await db
      .insert(schema.financeRefund)
      .values({ shopId, refundId: r.refundId, orderName: r.orderName, refundedAt: r.createdAt, refundWeek, amountCents: r.amountCents })
      .onConflictDoUpdate({
        target: [schema.financeRefund.shopId, schema.financeRefund.refundId],
        set: { orderName: r.orderName, refundedAt: r.createdAt, refundWeek, amountCents: r.amountCents, updatedAt: new Date() },
      });
  }
  return { count: refunds.length, totalCents };
}
