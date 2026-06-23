// Wochen-Zuordnung: Mo–So, Repello-Konvention KW01 = Mo 29.12.2025 – So 04.01.2026.
// Zuordnung über das Shopify-Bestelldatum, ausgewertet in Europe/Vienna (DST-sicher).

const ANCHOR_MONDAY_UTC = Date.UTC(2025, 11, 29); // Mo 29.12.2025
const DAY = 86_400_000;

/** Y-M-D des Datums in Wiener Zeit (DST-sicher), als [y,m,d]. */
function viennaYMD(d: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return [get("year"), get("month"), get("day")];
}

export type Week = { weekStart: string; kw: number };

/** Wochen-Key (Montag, YYYY-MM-DD) + KW-Nummer (relativ zum Anker) für ein Datum. */
export function weekOf(date: Date): Week {
  const [y, m, d] = viennaYMD(date);
  // Mitternacht des Wiener Kalendertags als UTC behandeln (nur Datumsarithmetik).
  const dayUtc = Date.UTC(y, m - 1, d);
  const dow = new Date(dayUtc).getUTCDay(); // 0=So..6=Sa
  const offsetToMonday = (dow + 6) % 7; // Mo=0
  const mondayUtc = dayUtc - offsetToMonday * DAY;
  const kw = Math.round((mondayUtc - ANCHOR_MONDAY_UTC) / (7 * DAY)) + 1;
  const iso = new Date(mondayUtc).toISOString().slice(0, 10);
  return { weekStart: iso, kw };
}

/** KW-Nummer eines Montags-Keys (YYYY-MM-DD). */
export function kwOfWeekStart(weekStart: string): number {
  const mondayUtc = Date.parse(`${weekStart}T00:00:00Z`);
  return Math.round((mondayUtc - ANCHOR_MONDAY_UTC) / (7 * DAY)) + 1;
}

/** Anzeige: "KW09". */
export function kwLabel(kw: number): string {
  return `KW${String(kw).padStart(2, "0")}`;
}

/** Montags-Key der aktuellen Woche. */
export function currentWeekStart(now = new Date()): string {
  return weekOf(now).weekStart;
}

/** Montags-Key N Wochen vor einem gegebenen Montag. */
export function shiftWeek(weekStart: string, weeks: number): string {
  const mondayUtc = Date.parse(`${weekStart}T00:00:00Z`) + weeks * 7 * DAY;
  return new Date(mondayUtc).toISOString().slice(0, 10);
}
