// COGS-Engine: Produktkosten je Line-Item — Mapping über den NAMEN (SKUs sind
// doppelt vergeben und unbrauchbar). Erste passende Regel greift. Beträge in Cent.

export const COGS_BUNDLE_CENTS = 584; // pro 2er-Bundle-Box (2 Geräte) = 5,84 €

export type LineCogs = {
  unitCents: number; // COGS pro Line-Einheit (× quantity = lineCents)
  lineCents: number;
  mapped: boolean; // false => unbekanntes Produkt, NICHT als 0 werten
};

/** COGS für ein Line-Item. Reihenfolge der Regeln ist bewusst (erste passende greift). */
export function cogsForLineItem(name: string, quantity: number): LineCogs {
  const n = (name ?? "").toLowerCase();
  const qty = Number(quantity) || 0;
  const r = (unitCents: number, mapped = true): LineCogs => ({ unitCents, lineCents: unitCents * qty, mapped });
  const has = (s: string) => n.includes(s);
  // "4x"/"6x" als Mengen-Token, nicht von einer größeren Zahl umschlossen.
  const hasMult = (d: string) => new RegExp(`(?<!\\d)${d}x`).test(n);

  if (has("sonic pulse pro")) {
    if (hasMult("4")) return r(1168); // 4 Geräte = 2 Bundles
    if (hasMult("6")) return r(1752); // 3 Bundles
    if (has("probiergerät") || has("probiergeraet")) return r(292); // 1 Gerät
    return r(COGS_BUNDLE_CENTS); // Standard 1 Bundle (inkl. "2x …")
  }
  if (has("m-shield")) return r(553);
  if (has("protect+") || has("juckreiz")) return r(154);
  if (has("gartenhandschuhe")) return r(67);
  // Upsells: Umsatz zählt, aber 0 € COGS.
  if (has("paketschutz") || has("bestellung vorziehen") || has("ebook") || has("e-book") || has("garten-guide") || has("garten guide")) {
    return r(0);
  }
  // Unbekannt -> flaggen, NICHT still 0 annehmen.
  return { unitCents: 0, lineCents: 0, mapped: false };
}
