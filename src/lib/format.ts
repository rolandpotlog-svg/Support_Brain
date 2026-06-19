// Relativzeit kompakt auf Deutsch: "18m", "3Std", "4T", "2Wo".
export function timeAgo(date: Date): string {
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return "jetzt";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}T`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}Wo`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

// Tag -> Farbklasse (.tag.blue / .amber / .rose, sonst grau).
const TAG_COLORS: Record<string, string> = {
  Bestellstatus: "blue",
  "Beschädigte Ware": "rose",
  "Retoure/Umtausch": "amber",
};
export function tagColor(tag: string | null | undefined): string {
  if (!tag) return "";
  return TAG_COLORS[tag] ?? "";
}

export function initials(name: string | null | undefined, fallback: string): string {
  const src = (name || fallback || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function euro(amount: number | string, currency = "EUR"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(
    isNaN(n) ? 0 : n,
  );
}
