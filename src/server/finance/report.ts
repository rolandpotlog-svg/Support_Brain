// Aggregiert die gespeicherten Finance-Rohdaten zu Wochen-PnL (neueste oben) + YTD.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { kwLabel, kwOfWeekStart } from "@/lib/finance/week";
import { computeWeekPnl, type WeekInputs, type WeekPnl } from "@/lib/finance/pnl";

export type WeekRow = {
  weekStart: string;
  kw: number;
  label: string;
  inputs: WeekInputs;
  pnl: WeekPnl;
  marketingByChannel: Record<string, number>;
  orderCount: number;
  shippingPending: number;
  unmappedOrders: number;
};

export type FinanceReport = {
  weeks: WeekRow[];
  ytd: {
    nettoumsatzCents: number;
    marketingCents: number;
    cogsCents: number;
    versandkostenCents: number;
    paymentFeeCents: number;
    pnlCents: number;
    margePct: number | null;
    roasGesamt: number | null;
    beRoasGesamt: number | null;
  };
};

export async function buildFinanceReport(shopId: string): Promise<FinanceReport> {
  const orders = await db
    .select()
    .from(schema.financeOrder)
    .where(eq(schema.financeOrder.shopId, shopId));
  const shippingRows = await db
    .select()
    .from(schema.financeShipping)
    .where(eq(schema.financeShipping.shopId, shopId));
  const marketingRows = await db
    .select()
    .from(schema.financeMarketing)
    .where(eq(schema.financeMarketing.shopId, shopId));
  const overrideRows = await db
    .select()
    .from(schema.financeCostOverride)
    .where(eq(schema.financeCostOverride.shopId, shopId));

  const shipByOrder = new Map(shippingRows.map((s) => [s.orderName, s.shippingCents]));
  const overrideByWeek = new Map(overrideRows.map((o) => [o.weekStart, o]));
  const marketingByWeek = new Map<string, Record<string, number>>();
  for (const m of marketingRows) {
    const w = marketingByWeek.get(m.weekStart) ?? {};
    w[m.channel] = (w[m.channel] ?? 0) + m.amountCents;
    marketingByWeek.set(m.weekStart, w);
  }

  // Pro Woche aggregieren.
  type Acc = {
    umsatzBrutto: number; rabatte: number; refunds: number; versandEinnahme: number; ust: number;
    cogs: number; versandkosten: number; orderCount: number; shippingPending: number; unmappedOrders: number;
  };
  const weeks = new Map<string, Acc>();
  const blank = (): Acc => ({
    umsatzBrutto: 0, rabatte: 0, refunds: 0, versandEinnahme: 0, ust: 0,
    cogs: 0, versandkosten: 0, orderCount: 0, shippingPending: 0, unmappedOrders: 0,
  });

  for (const o of orders) {
    const a = weeks.get(o.weekStart) ?? blank();
    a.umsatzBrutto += o.umsatzBruttoCents;
    a.rabatte += o.rabatteCents;
    a.refunds += o.refundsCents;
    a.versandEinnahme += o.versandEinnahmeCents;
    a.ust += o.ustCents;
    a.cogs += o.cogsCents;
    a.orderCount += 1;
    if (o.cogsUnknown) a.unmappedOrders += 1;
    if (shipByOrder.has(o.orderName)) a.versandkosten += shipByOrder.get(o.orderName)!;
    else a.shippingPending += 1;
    weeks.set(o.weekStart, a);
  }

  const rows: WeekRow[] = [...weeks.entries()]
    .map(([weekStart, a]) => {
      const mk = marketingByWeek.get(weekStart) ?? {};
      const marketing = Object.values(mk).reduce((s, v) => s + v, 0);
      const ov = overrideByWeek.get(weekStart);
      const inputs: WeekInputs = {
        // Shopify-Preise sind brutto (inkl. USt). USt rausrechnen -> Nettoumsatz ex-USt,
        // wie in der Spec (Gesamtumsatz = Netto + Versand + USt addiert die USt wieder dazu).
        umsatzBruttoCents: a.umsatzBrutto - a.ust,
        rabatteCents: a.rabatte,
        refundsCents: a.refunds,
        versandEinnahmeCents: a.versandEinnahme,
        ustCents: a.ust,
        marketingCents: marketing,
        produktkostenCents: a.cogs,
        versandkostenCents: a.versandkosten,
        fixkostenCents: ov?.fixkostenCents ?? 0,
        variableCents: ov?.variableCents ?? 0,
      };
      const kw = kwOfWeekStart(weekStart);
      return {
        weekStart,
        kw,
        label: kwLabel(kw),
        inputs,
        pnl: computeWeekPnl(inputs),
        marketingByChannel: mk,
        orderCount: a.orderCount,
        shippingPending: a.shippingPending,
        unmappedOrders: a.unmappedOrders,
      };
    })
    .sort((x, y) => (x.weekStart < y.weekStart ? 1 : -1)); // neueste oben

  // YTD: Cent-Felder summieren, Verhältnisse neu berechnen.
  let nett = 0, mkt = 0, cogs = 0, vers = 0, fee = 0, pnl = 0, gesamt = 0, leistbar = 0;
  for (const r of rows) {
    nett += r.pnl.nettoumsatzCents;
    mkt += r.inputs.marketingCents;
    cogs += r.inputs.produktkostenCents;
    vers += r.inputs.versandkostenCents;
    fee += r.pnl.paymentFeeCents;
    pnl += r.pnl.pnlCents;
    gesamt += r.pnl.gesamtumsatzCents;
    leistbar += r.pnl.leistbarCents;
  }
  return {
    weeks: rows,
    ytd: {
      nettoumsatzCents: nett,
      marketingCents: mkt,
      cogsCents: cogs,
      versandkostenCents: vers,
      paymentFeeCents: fee,
      pnlCents: pnl,
      margePct: nett !== 0 ? pnl / nett : null,
      roasGesamt: mkt > 0 ? gesamt / mkt : null,
      beRoasGesamt: leistbar > 0 ? gesamt / leistbar : null,
    },
  };
}
