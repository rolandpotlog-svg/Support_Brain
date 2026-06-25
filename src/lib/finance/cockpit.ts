// Cockpit-Kennzahlen + GuV-Wasserfall — reine Ableitungen aus der bestehenden
// Wochen-PnL (keine zweite Rechen-Engine). Beträge in Cent.
import type { WeekInputs, WeekPnl, Ampel } from "./pnl";

export type CockpitMetrics = {
  nettoCents: number;
  dbVorWerbungCents: number;
  dbNachWerbungCents: number; // = PnL vor Fix
  profitCents: number;
  spendCents: number;
  blendedRoas: number | null;
  beRoas: number | null;
  gap: number | null; // Blended − BE  (Headline-Steuersignal)
  margePct: number | null;
  rabattquote: number | null;
  retourenquote: number | null;
  aovCents: number | null;
  cogsPct: number | null;
  versandPct: number | null;
  dbMargePct: number | null;
  ampel: Ampel;
};

export function cockpitMetrics(inputs: WeekInputs, pnl: WeekPnl, orderCount: number): CockpitMetrics {
  const brutto = inputs.umsatzBruttoCents;
  const netto = pnl.nettoumsatzCents;
  const gap = pnl.roasGesamt != null && pnl.beRoasGesamt != null ? pnl.roasGesamt - pnl.beRoasGesamt : null;
  const pct = (num: number, den: number) => (den > 0 ? num / den : null);
  return {
    nettoCents: netto,
    dbVorWerbungCents: pnl.deckungsbeitragCents,
    dbNachWerbungCents: pnl.deckungsbeitragCents - inputs.marketingCents,
    profitCents: pnl.pnlCents,
    spendCents: inputs.marketingCents,
    blendedRoas: pnl.roasGesamt,
    beRoas: pnl.beRoasGesamt,
    gap,
    margePct: pnl.margePct,
    rabattquote: pct(inputs.rabatteCents, brutto),
    retourenquote: pct(inputs.refundsCents, brutto),
    aovCents: orderCount > 0 ? Math.round(brutto / orderCount) : null,
    cogsPct: pct(inputs.produktkostenCents, netto),
    versandPct: pct(inputs.versandkostenCents, netto),
    dbMargePct: pct(pnl.deckungsbeitragCents, netto),
    ampel: pnl.ampel,
  };
}

export type WaterfallStep = { label: string; cents: number; pctOfNet: number | null; kind: "base" | "minus" | "subtotal" | "result" };

export function waterfallSteps(inputs: WeekInputs, pnl: WeekPnl): WaterfallStep[] {
  const net = pnl.nettoumsatzCents;
  const p = (c: number): number | null => (net > 0 ? c / net : null);
  const dbNach = pnl.deckungsbeitragCents - inputs.marketingCents;
  return [
    { label: "Bruttoumsatz", cents: inputs.umsatzBruttoCents, pctOfNet: p(inputs.umsatzBruttoCents), kind: "base" },
    { label: "− Rabatte", cents: -inputs.rabatteCents, pctOfNet: p(-inputs.rabatteCents), kind: "minus" },
    { label: "− Retouren", cents: -inputs.refundsCents, pctOfNet: p(-inputs.refundsCents), kind: "minus" },
    { label: "= Nettoumsatz", cents: net, pctOfNet: p(net), kind: "subtotal" },
    { label: "− COGS", cents: -inputs.produktkostenCents, pctOfNet: p(-inputs.produktkostenCents), kind: "minus" },
    { label: "− Versandkosten", cents: -inputs.versandkostenCents, pctOfNet: p(-inputs.versandkostenCents), kind: "minus" },
    { label: "− Payment Fee", cents: -pnl.paymentFeeCents, pctOfNet: p(-pnl.paymentFeeCents), kind: "minus" },
    { label: "= Deckungsbeitrag (vor Werbung)", cents: pnl.deckungsbeitragCents, pctOfNet: p(pnl.deckungsbeitragCents), kind: "subtotal" },
    { label: "− Marketing", cents: -inputs.marketingCents, pctOfNet: p(-inputs.marketingCents), kind: "minus" },
    { label: "= DB nach Werbung (PnL vor Fix)", cents: dbNach, pctOfNet: p(dbNach), kind: "subtotal" },
    { label: "− Fixkosten", cents: -inputs.fixkostenCents, pctOfNet: p(-inputs.fixkostenCents), kind: "minus" },
    { label: "= Profit", cents: pnl.pnlCents, pctOfNet: p(pnl.pnlCents), kind: "result" },
  ];
}
