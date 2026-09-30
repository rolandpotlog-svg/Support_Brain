// Anliegen-Erkennung („Standard-Mails“): feste E-Commerce-Anliegen je Ticket.
// Steuert Entwurf (Ablauf je Anliegen), Posteingang (Warteschlangen/Badges) und Auswertung.
// Reine Lib — von Worker, Server und UI gemeinsam genutzt.
import type { Category } from "@/lib/reports/categories";

export const INTENTS = [
  { key: "wismo", label: "Wo ist meine Bestellung (erste Anfrage)", short: "WISMO", category: "Versandverzögerung/WISMO" },
  { key: "nachfrage", label: "Erneute Nachfrage — Kunde hat zur Lieferung schon einmal geschrieben", short: "Nachfrage", category: "Versandverzögerung/WISMO" },
  { key: "nicht_erhalten", label: "Zugestellt, aber nicht erhalten / verloren", short: "Nicht erhalten", category: "Nicht erhalten/Lieferproblem" },
  { key: "beschaedigt", label: "Beschädigt angekommen", short: "Beschädigt", category: "Defekt/Reklamation" },
  { key: "defekt", label: "Defekt / kaputt gegangen", short: "Defekt", category: "Defekt/Reklamation" },
  { key: "gravur_fehler", label: "Gravur falsch oder fehlt", short: "Gravur falsch", category: "Defekt/Reklamation" },
  { key: "falsch_fehlt", label: "Falscher oder fehlender Artikel", short: "Falsch/fehlt", category: "Defekt/Reklamation" },
  { key: "gravur_angaben", label: "Gravur-Namen nachreichen / ändern", short: "Gravur-Angaben", category: "Produktfrage" },
  { key: "storno", label: "Stornierung", short: "Storno", category: "Retoure/Umtausch" },
  { key: "retoure", label: "Rückgabe / Umtausch / Erstattung", short: "Retoure", category: "Retoure/Umtausch" },
  { key: "adresse", label: "Adresse ändern / Zustellung umleiten", short: "Adresse", category: "Nicht erhalten/Lieferproblem" },
  { key: "zahlung", label: "Zahlung, Rechnung, Rabattcode", short: "Zahlung/Code", category: "Zahlung/Rechnung" },
  { key: "produktfrage", label: "Frage zum Produkt (Material, Farbe, Pflege …)", short: "Produktfrage", category: "Produktfrage" },
  { key: "nicht_wie_erwartet", label: "Gefällt nicht / anders als erwartet", short: "Nicht wie erwartet", category: "Nicht wie erwartet" },
  { key: "lob", label: "Lob / Dank", short: "Lob", category: "Sonstiges" },
  { key: "sonstiges", label: "Sonstiges", short: "Sonstiges", category: "Sonstiges" },
] as const satisfies readonly { key: string; label: string; short: string; category: Category }[];

export type IntentKey = (typeof INTENTS)[number]["key"];
const BY_KEY = new Map<string, (typeof INTENTS)[number]>(INTENTS.map((i) => [i.key, i]));

export function normalizeIntent(k: string | null | undefined): IntentKey {
  return (k && BY_KEY.has(k) ? k : "sonstiges") as IntentKey;
}
export function intentLabel(k: string | null | undefined): string {
  return BY_KEY.get(k ?? "")?.label ?? "Sonstiges";
}
export function intentShort(k: string | null | undefined): string {
  return BY_KEY.get(k ?? "")?.short ?? "—";
}
export function intentCategory(k: string | null | undefined): Category {
  return (BY_KEY.get(k ?? "")?.category ?? "Sonstiges") as Category;
}
/** Anliegen, bei denen ein Produktproblem vorliegt (für die Produktanalyse / Supplier-Liste). */
export const PROBLEM_INTENTS = new Set<IntentKey>(["beschaedigt", "defekt", "gravur_fehler", "falsch_fehlt", "nicht_wie_erwartet"]);
