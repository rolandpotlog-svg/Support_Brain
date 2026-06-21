// Ökonomie-Engine: ermittelt den max. "Behalten"-Rabatt, bei dem das Behalten
// noch günstiger ist als die physische Retoure. Alle Beträge in Cent.

export type EconParams = {
  cogsPct: number; // COGS = % vom Artikelpreis
  returnShippingCents: number;
  resaleableDefault: boolean;
  voucherBonusPct: number;
  firstOfferPct: number;
  highValueThresholdCents: number;
};

export function lineValueCents(unitPriceCents: number, qty: number): number {
  return unitPriceCents * qty;
}

/** Kosten einer physischen Retoure = Rücksendung + (nicht wiederverkäuflich ? COGS : 0). */
export function returnCostCents(unitPriceCents: number, qty: number, p: EconParams): number {
  const value = unitPriceCents * qty;
  const cogs = Math.round((value * p.cogsPct) / 100);
  return p.returnShippingCents + (p.resaleableDefault ? 0 : cogs);
}

/** Obergrenze für den "Behalten"-Rabatt — gedeckelt auf den Artikelwert. */
export function maxKeepRefundCents(unitPriceCents: number, qty: number, p: EconParams): number {
  return Math.max(0, Math.min(returnCostCents(unitPriceCents, qty, p), unitPriceCents * qty));
}

/** Eskalierende Angebotsleiter (Cent): 1. Angebot = firstOfferPct% der Obergrenze, dann Obergrenze. */
export function offerLadderCents(maxKeep: number, p: EconParams): number[] {
  if (maxKeep <= 0) return [];
  const first = Math.round((maxKeep * p.firstOfferPct) / 100);
  const ladder = [first, maxKeep].filter((x) => x > 0);
  return [...new Set(ladder)].sort((a, b) => a - b);
}

/** Gutschein ist dir mehr wert als Cash -> wir bieten +X% Wert an. */
export function voucherValueCents(cashCents: number, p: EconParams): number {
  return Math.round((cashCents * (100 + p.voucherBonusPct)) / 100);
}

export function isHighValue(unitPriceCents: number, qty: number, p: EconParams): boolean {
  return unitPriceCents * qty >= p.highValueThresholdCents;
}

export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}
