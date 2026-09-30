// COGS-Engine: Produktkosten je Line-Item — Mapping über den NAMEN (SKUs sind
// doppelt vergeben und unbrauchbar). Erste passende Regel greift. Beträge in Cent.
// Basis-Stückkosten sind editierbar (Supplier-Preise); die Bundle-/Mengen-Logik
// (4× = 2 Bundles, 6× = 3, Probiergerät = ½) bleibt strukturell hier.

export type CogsRates = {
  sonic_pulse_bundle: number; // 2er-Bundle-Box (2 Geräte)
  m_shield: number;
  protect_plus: number;
  gartenhandschuhe: number;
};

export const COGS_RATE_DEFAULTS: CogsRates = {
  sonic_pulse_bundle: 584, // 5,84 €
  m_shield: 553,
  protect_plus: 154,
  gartenhandschuhe: 67,
};

/** Editierbare Posten + Anzeige-Label (Reihenfolge = UI-Reihenfolge). */
export const COGS_RATE_DEFS: { key: keyof CogsRates; label: string; hint: string }[] = [
  { key: "sonic_pulse_bundle", label: "Sonic Pulse Pro — Bundle (2 Geräte)", hint: "4× = 2 Bundles · 6× = 3 · Probiergerät = ½" },
  { key: "m_shield", label: "M-Shield", hint: "pro Stück" },
  { key: "protect_plus", label: "Protect+ / Juckreiz", hint: "pro Stück" },
  { key: "gartenhandschuhe", label: "Gartenhandschuhe", hint: "pro Paar" },
];

/** @deprecated nur für Altskripte — Default-Bundle. */
export const COGS_BUNDLE_CENTS = COGS_RATE_DEFAULTS.sonic_pulse_bundle;

/** Repello (und Garten Expert) rechnen mit der festen Regel-Engine unten (Bundles etc.).
 *  Alle anderen Shops: Einkaufspreis je Produkt aus der Tabelle finance_product_cost. */
export function usesRuleEngine(shopSlug: string | null | undefined): boolean {
  return /rep+ello/.test((shopSlug ?? "").toLowerCase());
}

/** Schlüssel für die Produkt-Kostentabelle: Titel normalisiert (Groß/Klein, Leerzeichen egal). */
export function productKey(title: string): string {
  return (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Upsells ohne Wareneinsatz (Umsatz zählt, COGS = 0) — für alle Shops gleich. */
export function isZeroCostUpsell(title: string): boolean {
  const n = (title ?? "").toLowerCase();
  return ["paketschutz", "bestellung vorziehen", "ebook", "e-book", "garten-guide", "garten guide", "versandschutz"].some((s) => n.includes(s));
}

/** COGS eines Line-Items für Shops mit Produkt-Kostentabelle. Unbekannt -> geflaggt, nie still 0. */
export function cogsFromProductTable(title: string, quantity: number, costs: Map<string, number>): LineCogs {
  const qty = Number(quantity) || 0;
  if (isZeroCostUpsell(title)) return { unitCents: 0, lineCents: 0, mapped: true };
  const unit = costs.get(productKey(title));
  if (unit == null) return { unitCents: 0, lineCents: 0, mapped: false };
  return { unitCents: unit, lineCents: unit * qty, mapped: true };
}

export type LineCogs = {
  unitCents: number; // COGS pro Line-Einheit (× quantity = lineCents)
  lineCents: number;
  mapped: boolean; // false => unbekanntes Produkt, NICHT als 0 werten
};

/** Produkt-Kategorie eines Line-Items (für „was wurde bestellt"-Übersicht / Supplier-Abgleich). */
export function categorizeLineItem(name: string): string {
  const n = (name ?? "").toLowerCase();
  const has = (s: string) => n.includes(s);
  if (has("sonic pulse pro")) return "Sonic Pulse Pro";
  if (has("m-shield")) return "M-Shield";
  if (has("protect+") || has("juckreiz")) return "Protect+ / Juckreiz";
  if (has("gartenhandschuhe")) return "Gartenhandschuhe";
  if (has("paketschutz") || has("bestellung vorziehen") || has("ebook") || has("e-book") || has("garten-guide") || has("garten guide")) {
    return "Upsell (0 €)";
  }
  return `❓ ${name || "Unbekannt"}`;
}

/** COGS für ein Line-Item. Reihenfolge der Regeln ist bewusst (erste passende greift). */
export function cogsForLineItem(name: string, quantity: number, rates: CogsRates = COGS_RATE_DEFAULTS): LineCogs {
  const n = (name ?? "").toLowerCase();
  const qty = Number(quantity) || 0;
  const r = (unitCents: number, mapped = true): LineCogs => ({ unitCents, lineCents: unitCents * qty, mapped });
  const has = (s: string) => n.includes(s);
  // "4x"/"6x" als Mengen-Token, nicht von einer größeren Zahl umschlossen.
  const hasMult = (d: string) => new RegExp(`(?<!\\d)${d}x`).test(n);

  if (has("sonic pulse pro")) {
    const bundle = rates.sonic_pulse_bundle;
    if (hasMult("4")) return r(bundle * 2); // 4 Geräte = 2 Bundles
    if (hasMult("6")) return r(bundle * 3); // 3 Bundles
    if (has("probiergerät") || has("probiergeraet")) return r(Math.round(bundle / 2)); // 1 Gerät
    return r(bundle); // Standard 1 Bundle (inkl. "2x …")
  }
  if (has("m-shield")) return r(rates.m_shield);
  if (has("protect+") || has("juckreiz")) return r(rates.protect_plus);
  if (has("gartenhandschuhe")) return r(rates.gartenhandschuhe);
  // Upsells: Umsatz zählt, aber 0 € COGS.
  if (has("paketschutz") || has("bestellung vorziehen") || has("ebook") || has("e-book") || has("garten-guide") || has("garten guide")) {
    return r(0);
  }
  // Unbekannt -> flaggen, NICHT still 0 annehmen.
  return { unitCents: 0, lineCents: 0, mapped: false };
}
