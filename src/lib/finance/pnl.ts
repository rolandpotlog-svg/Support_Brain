// PnL-Engine (rein, testbar). Alle Geldwerte in Cent. Formeln exakt nach Repello-Spec.

export const PAYMENT_FEE_RATE = 0.04; // 4 % vom Gesamtumsatz (brutto)
export const UST_RATE = 0.2; // Österreich 20 %
export const AMPEL_GREEN_MARGIN = 1.15; // grün ab BE-ROAS × 1,15

export type WeekInputs = {
  umsatzBruttoCents: number; // Σ Subtotal vor Rabatt/Refund
  rabatteCents: number;
  refundsCents: number;
  versandEinnahmeCents: number; // vom Kunden bezahlter Versand
  ustCents: number; // Steueranteil aus Shopify
  marketingCents: number; // Σ aller Kanäle
  produktkostenCents: number; // COGS-Engine
  versandkostenCents: number; // Versand-Engine
  fixkostenCents: number; // manuell
  variableCents: number; // manuell
};

export type Ampel = "rot" | "gelb" | "gruen" | "neutral";

export type WeekPnl = {
  nettoumsatzCents: number;
  gesamtumsatzCents: number;
  paymentFeeCents: number;
  kostenTotalCents: number;
  deckungsbeitragCents: number;
  pnlCents: number;
  margePct: number | null;
  roasGesamt: number | null;
  roasNetto: number | null;
  leistbarCents: number;
  beRoasNetto: number | null;
  beRoasGesamt: number | null;
  ampel: Ampel;
};

export function computeWeekPnl(i: WeekInputs): WeekPnl {
  const nettoumsatz = i.umsatzBruttoCents - i.rabatteCents - i.refundsCents;
  const gesamtumsatz = nettoumsatz + i.versandEinnahmeCents + i.ustCents;
  const paymentFee = Math.round(gesamtumsatz * PAYMENT_FEE_RATE);
  const kostenTotal =
    i.marketingCents + i.produktkostenCents + i.versandkostenCents + paymentFee + i.fixkostenCents + i.variableCents;
  const deckungsbeitrag =
    nettoumsatz - i.produktkostenCents - i.versandkostenCents - paymentFee - i.variableCents; // vor Fix
  const pnl = nettoumsatz - kostenTotal;
  const margePct = nettoumsatz !== 0 ? pnl / nettoumsatz : null;

  const m = i.marketingCents;
  const roasGesamt = m > 0 ? gesamtumsatz / m : null;
  const roasNetto = m > 0 ? nettoumsatz / m : null;

  // Was Marketing höchstens kosten darf, damit die Woche ±0 ist (vor Marketing).
  const leistbar =
    nettoumsatz - i.produktkostenCents - i.versandkostenCents - paymentFee - i.fixkostenCents - i.variableCents;
  const beRoasNetto = leistbar > 0 ? nettoumsatz / leistbar : null;
  const beRoasGesamt = leistbar > 0 ? gesamtumsatz / leistbar : null;

  let ampel: Ampel;
  if (m <= 0) {
    // Ohne erfassten Marketing-Spend lässt sich die Woche nicht bewerten -> neutral
    // (sonst täuscht "grün" Profitabilität vor, obwohl Werbekosten fehlen).
    ampel = "neutral";
  } else if (beRoasGesamt === null || roasGesamt === null) {
    // Kein positiver Spielraum vor Ads -> jede Ad-Ausgabe = Verlust.
    ampel = "rot";
  } else if (roasGesamt < beRoasGesamt) {
    ampel = "rot";
  } else if (roasGesamt < beRoasGesamt * AMPEL_GREEN_MARGIN) {
    ampel = "gelb";
  } else {
    ampel = "gruen";
  }

  return {
    nettoumsatzCents: nettoumsatz,
    gesamtumsatzCents: gesamtumsatz,
    paymentFeeCents: paymentFee,
    kostenTotalCents: kostenTotal,
    deckungsbeitragCents: deckungsbeitrag,
    pnlCents: pnl,
    margePct,
    roasGesamt,
    roasNetto,
    leistbarCents: leistbar,
    beRoasNetto,
    beRoasGesamt,
    ampel,
  };
}
