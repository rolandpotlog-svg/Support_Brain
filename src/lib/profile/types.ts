// Shop-Profil ("Antwort-Gehirn") — sechs Blöcke. Reine Typen + deterministischer
// System-Prompt-Bau, damit Client und Server dasselbe Modell teilen (keine Server-Imports!).

export type FieldSource = "auto" | "confirmed" | "todo";
export type FaqItem = { q: string; a: string };

export type ProfileData = {
  // 1) Basis & Identität
  whatSold: string;
  brandCore: string;
  website: string;
  supportHours: string;
  // 2) Tonalität
  address: "" | "du" | "sie";
  style: "" | "locker" | "sachlich" | "premium";
  greeting: string;
  signature: string;
  emojis: "" | "ja" | "nein";
  length: "" | "kurz" | "mittel" | "lang";
  // Gesprächsabschluss: "abschliessen" = nie zum Nachschreiben einladen (Default, Repello);
  // "einladen" = Kunde wird freundlich eingeladen, sich bei Fragen wieder zu melden (Lovenja).
  closing?: "" | "abschliessen" | "einladen";
  examples: string[];
  // 3) Richtlinien
  returnPeriod: string;
  notReturnable: string;
  exchange: string;
  refund: string;
  shipping: string;
  damage: string;
  discountAuthority: string;
  // 4) Produktwissen & FAQ
  faq: FaqItem[];
  specialties: string;
  // 5) Grenzen / Don'ts
  donts: string;
  // 6) Eskalationsregeln
  escalationRules: string;
};

export type ProfileSources = Partial<Record<keyof ProfileData, FieldSource>>;

/** Felder, die NICHT automatisch befüllbar sind — der Mensch muss sie setzen. */
export const HUMAN_ONLY: (keyof ProfileData)[] = [
  "address",
  "discountAuthority",
  "escalationRules",
  "donts",
];

export function emptyProfile(): ProfileData {
  return {
    whatSold: "", brandCore: "", website: "", supportHours: "",
    address: "", style: "", greeting: "", signature: "", emojis: "", length: "", closing: "",
    examples: [],
    returnPeriod: "", notReturnable: "", exchange: "", refund: "", shipping: "",
    damage: "", discountAuthority: "",
    faq: [],
    specialties: "",
    donts: "",
    escalationRules: "",
  };
}

const ADDRESS_LABEL = { du: "Duzen (Du)", sie: "Siezen (Sie)", "": "" } as const;
const STYLE_LABEL = { locker: "locker", sachlich: "sachlich", premium: "premium", "": "" } as const;
const LENGTH_LABEL = { kurz: "kurz", mittel: "mittel", lang: "ausführlich", "": "" } as const;

function section(title: string, lines: (string | null | undefined)[]): string | null {
  const body = lines.filter((l): l is string => Boolean(l && l.trim()));
  if (body.length === 0) return null;
  return `## ${title}\n${body.join("\n")}`;
}

/** Deterministischer System-Prompt aus den Profil-Feldern (Phase B optimiert ihn ggf. sprachlich). */
export function buildSystemPrompt(data: ProfileData, shopName: string): string {
  const blocks: (string | null)[] = [];

  blocks.push(
    `Du bist die Kundensupport-Assistenz für den Shop „${shopName}". ` +
      `Du verfasst markengerechte, regelkonforme E-Mail-Antworten auf Kundenanfragen. ` +
      `Entwirf nur Antworten — ein Mensch gibt sie vor dem Versand frei.`,
  );

  blocks.push(
    section("Über den Shop", [
      data.whatSold && `Sortiment: ${data.whatSold}`,
      data.brandCore && `Markenkern: ${data.brandCore}`,
      data.website && `Website: ${data.website}`,
      data.supportHours && `Support-Zeiten: ${data.supportHours}`,
    ]),
  );

  blocks.push(
    section("Tonalität", [
      data.address && `Anrede: ${ADDRESS_LABEL[data.address]}.`,
      data.style && `Stil: ${STYLE_LABEL[data.style]}.`,
      data.length && `Antwortlänge: ${LENGTH_LABEL[data.length]}.`,
      data.emojis && `Emojis: ${data.emojis === "ja" ? "sparsam erlaubt" : "nicht verwenden"}.`,
      data.greeting && `Begrüßung: „${data.greeting}".`,
      // Signatur NICHT als Anweisung — sie wird deterministisch an den Entwurf angehängt
      // (immer exakt gleich, kann nicht von der KI abgewandelt werden).
      // Defensiv: examples/faq können in Altdaten null sein -> als leere Liste behandeln.
      ...(data.examples ?? []).filter(Boolean).map((ex, i) => `Beispiel-Antwort ${i + 1}:\n${ex}`),
    ]),
  );

  blocks.push(
    section("Richtlinien (verbindlich)", [
      data.returnPeriod && `Retoure: ${data.returnPeriod}`,
      data.notReturnable && `Nicht retournierbar: ${data.notReturnable}`,
      data.exchange && `Umtausch: ${data.exchange}`,
      data.refund && `Erstattung: ${data.refund}`,
      data.shipping && `Versand: ${data.shipping}`,
      data.damage && `Schäden/Reklamation: ${data.damage}`,
      data.discountAuthority && `Rabatt-Befugnis des Supports: ${data.discountAuthority}`,
    ]),
  );

  blocks.push(
    section("Produktwissen & häufige Fragen", [
      data.specialties && `Besonderheiten: ${data.specialties}`,
      ...(data.faq ?? [])
        .filter((f) => f.q.trim() || f.a.trim())
        .map((f) => `F: ${f.q}\nA: ${f.a}`),
    ]),
  );

  blocks.push(
    section("Grenzen / Don'ts (niemals zusagen)", [data.donts]),
  );

  blocks.push(
    section("Eskalation — NICHT selbst antworten, an einen Menschen abgeben, wenn", [
      data.escalationRules,
    ]),
  );

  blocks.push(
    section("Arbeitsweise", [
      "Beziehe dich auf die echten Bestelldaten des Tickets, wenn vorhanden.",
      "Erfinde keine Fakten (Tracking-Nummern, Fristen, Beträge) — wenn etwas unklar ist, kläre es oder eskaliere.",
      "Halte dich strikt an die Richtlinien oben; bei Konflikt zwischen Kundenwunsch und Richtlinie hat die Richtlinie Vorrang.",
    ]),
  );

  return blocks.filter((b): b is string => Boolean(b)).join("\n\n");
}
