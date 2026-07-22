// HTML-Mail -> lesbarer Klartext. Viele Mails (Outlook/Apple Mail/Shops) haben KEINEN
// text/plain-Teil — ohne diese Ableitung bleibt der Ticket-Verlauf leer ("nur Absender, kein Inhalt").
const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  euro: "€", hellip: "…", ndash: "–", mdash: "—", rsquo: "'", lsquo: "'", ldquo: "„", rdquo: "“",
};

export function htmlToPlainText(html: string): string {
  let s = html;
  // Nicht-sichtbares komplett raus.
  s = s.replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Struktur in Zeilenumbrüche übersetzen.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)>/gi, "\n");
  // Restliche Tags entfernen.
  s = s.replace(/<[^>]+>/g, " ");
  // Entities auflösen (benannte + numerische).
  s = s.replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name] ?? m);
  s = s.replace(/&#(\d+);/g, (_, d: string) => {
    const code = Number(d);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : " ";
  });
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : " ";
  });
  // Whitespace aufräumen.
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/ ?\n ?/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Bester lesbarer Text einer Nachricht: Klartext, sonst aus HTML abgeleitet. */
export function bestBodyText(bodyText: string | null, bodyHtml: string | null): string | null {
  if (bodyText && bodyText.trim()) return bodyText;
  if (bodyHtml && bodyHtml.trim()) return htmlToPlainText(bodyHtml);
  return null;
}
