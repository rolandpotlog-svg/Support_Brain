// Feste, gut unterscheidbare Farbe je Shop (aus dem Slug abgeleitet — stabil, ohne DB-Feld).
// Damit sieht man überall sofort, in welchem Shop man arbeitet.
const PALETTE = ["#0f766e", "#b4476e", "#4f46e5", "#c2410c", "#15803d", "#7c3aed", "#0369a1", "#a16207"];
const KNOWN: Record<string, string> = { reppello: "#15803d", repello: "#15803d", lovenja: "#b4476e" };

export function shopColor(slug: string | null | undefined): string {
  const s = (slug ?? "").toLowerCase();
  for (const [k, c] of Object.entries(KNOWN)) if (s.includes(k)) return c;
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
