// Schattenbetrieb: KI-Entwurf gegen die echte Antwort des Teams (aus dem Webmail) vergleichen.
// Frage ist nicht „gleicher Wortlaut“, sondern: Hätte der Entwurf die echte Antwort ersetzen können?
// Die Abweichung wird als Lektion formuliert — Rohstoff für den Lern-Loop.
import { complete } from "@/server/ai";

const SYSTEM =
  "Du prüfst im Kundensupport, ob ein KI-Antwortentwurf die tatsächlich gesendete Antwort eines Mitarbeiters hätte ersetzen können. " +
  "Maßgeblich ist der INHALT: gleiche Entscheidung und Lösung, gleiche Zusagen oder Absagen (Ersatz, Erstattung, Storno, Gutschrift), gleiche Rabattcodes, " +
  "gleiche Fakten (Tracking, Adressen, Fristen), keine fehlende wichtige Information und nichts, was der Mitarbeiter bewusst NICHT gesagt hat. " +
  "Formulierung, Länge, Anrede und Grußformel sind egal, solange der Ton passt. " +
  'Antworte NUR mit JSON: {"passt":true|false,"lektion":"ein bis zwei Sätze: was die echte Antwort anders/besser macht, als allgemeine Regel formuliert (leer, wenn passt)"}';

export async function compareShadow(opts: {
  customerText: string;
  draft: string;
  actual: string;
}): Promise<{ match: boolean; note: string }> {
  const raw = await complete({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `KUNDENANFRAGE:\n${opts.customerText.slice(0, 6000)}\n\nKI-ENTWURF:\n${opts.draft}\n\nECHTE ANTWORT DES TEAMS:\n${opts.actual}`,
      },
    ],
    maxTokens: 1500,
    effort: "low",
    kind: "vergleich",
  });
  try {
    const j = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
    return { match: Boolean(j.passt), note: String(j.lektion ?? "").trim() };
  } catch {
    return { match: false, note: `Vergleich nicht auswertbar: ${raw.slice(0, 200)}` };
  }
}

/** Zitierten Verlauf aus einer Webmail-Antwort entfernen („Am … schrieb …“, „-----Original“, „> …“). */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex(
    (l) =>
      /^\s*Am .{4,120}(schrieb|wrote)/i.test(l) ||
      /^\s*On .{4,120}wrote/i.test(l) ||
      /^\s*-{2,}\s*(Original|Ursprüngliche Nachricht|Weitergeleitete)/i.test(l) ||
      /^\s*(Von|From):\s.+/.test(l) ||
      /^\s*>/.test(l),
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}
