// Feste Taxonomie für die Ticket-Klassifizierung + Mapping auf Geschäftsbereiche
// (Frühwarnsystem). Reine Lib — von Klassifizierung, Report und UI gemeinsam genutzt.

export const CATEGORIES = [
  "Versandverzögerung/WISMO",
  "Nicht erhalten/Lieferproblem",
  "Retoure/Umtausch",
  "Defekt/Reklamation",
  "Größe/Passform",
  "Zahlung/Rechnung",
  "Produktfrage",
  "Nicht wie erwartet",
  "Sonstiges",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SENTIMENTS = ["positiv", "neutral", "negativ"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Welcher Geschäftsbereich ist betroffen, wenn eine Kategorie ausschlägt? (Frühwarnung) */
export const CATEGORY_AREA: Partial<Record<Category, string>> = {
  "Versandverzögerung/WISMO": "Fulfillment/Versand (z. B. 3PL prüfen)",
  "Nicht erhalten/Lieferproblem": "Fulfillment/Versand (Zustellung, Carrier)",
  "Defekt/Reklamation": "Lieferant/Qualität",
  "Nicht wie erwartet": "Werbung/Landingpage (Erwartungssteuerung)",
  "Größe/Passform": "Produktinfo/Sizing (ggf. Werbung)",
};

export function normalizeCategory(c: string | null | undefined): Category {
  if (c && (CATEGORIES as readonly string[]).includes(c)) return c as Category;
  return "Sonstiges";
}
