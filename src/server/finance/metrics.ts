// Fenster-Aggregation für Tagesansichten (Heute / Rolling-7). Liefert Orders,
// Umsatz, Spend (aus Tages-Audit) + ROAS — bewusst KEIN Profit (Refund-/Versand-Lag).
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type WindowMetrics = {
  since: string;
  until: string;
  orders: number;
  bruttoCents: number;
  nettoCents: number;
  gesamtCents: number;
  refundsCents: number;
  spendCents: number;
  spendByChannel: Record<string, number>;
  roasGesamt: number | null;
  roasNetto: number | null;
  spendMissing: boolean; // Orders da, aber kein Tages-Spend -> Marketing unvollständig
};

export async function getWindowMetrics(shopId: string, since: string, until: string): Promise<WindowMetrics> {
  const [o] = await db
    .select({
      orders: sql<number>`count(*)::int`,
      brutto: sql<number>`coalesce(sum(umsatz_brutto_cents),0)::int`,
      ust: sql<number>`coalesce(sum(ust_cents),0)::int`,
      rabatte: sql<number>`coalesce(sum(rabatte_cents),0)::int`,
      refunds: sql<number>`coalesce(sum(refunds_cents),0)::int`,
      versandEinnahme: sql<number>`coalesce(sum(versand_einnahme_cents),0)::int`,
    })
    .from(schema.financeOrder)
    .where(and(
      eq(schema.financeOrder.shopId, shopId),
      sql`${schema.financeOrder.createdAt}::date >= ${since}`,
      sql`${schema.financeOrder.createdAt}::date <= ${until}`,
    ));

  // brutto inkl. USt (Shopify-Konvention) -> Netto = brutto − USt − Rabatte − Refunds.
  const nettoCents = o.brutto - o.ust - o.rabatte - o.refunds;
  const gesamtCents = nettoCents + o.versandEinnahme + o.ust;

  const spendRows = await db
    .select({ channel: schema.financeMarketingDaily.channel, amount: sql<number>`coalesce(sum(amount_cents),0)::int` })
    .from(schema.financeMarketingDaily)
    .where(and(
      eq(schema.financeMarketingDaily.shopId, shopId),
      sql`${schema.financeMarketingDaily.date} >= ${since}`,
      sql`${schema.financeMarketingDaily.date} <= ${until}`,
    ))
    .groupBy(schema.financeMarketingDaily.channel);
  const spendByChannel: Record<string, number> = {};
  let spendCents = 0;
  for (const r of spendRows) {
    spendByChannel[r.channel] = r.amount;
    spendCents += r.amount;
  }

  return {
    since,
    until,
    orders: o.orders,
    bruttoCents: o.brutto,
    nettoCents,
    gesamtCents,
    refundsCents: o.refunds,
    spendCents,
    spendByChannel,
    roasGesamt: spendCents > 0 ? gesamtCents / spendCents : null,
    roasNetto: spendCents > 0 ? nettoCents / spendCents : null,
    spendMissing: o.orders > 0 && spendCents === 0,
  };
}
