// Facebook-Kommentare: Intent-Taxonomie + Routing. Höchste Vorsicht bei öffentlichen
// Antworten — Auto nur für klar sichere Kategorien (FAQ/Lob).

export const COMMENT_INTENTS = [
  "frage_faq",
  "lob",
  "beschwerde",
  "bestellbezogen",
  "spam",
  "troll",
  "offtopic",
] as const;
export type CommentIntent = (typeof COMMENT_INTENTS)[number];

export const INTENT_LABEL: Record<CommentIntent, string> = {
  frage_faq: "Frage/FAQ",
  lob: "Lob/positiv",
  beschwerde: "Beschwerde",
  bestellbezogen: "Bestellbezogen",
  spam: "Spam",
  troll: "Troll/Beleidigung",
  offtopic: "Off-topic",
};

/** Nur diese Kategorien dürfen jemals öffentlich automatisch beantwortet werden. */
export const AUTO_SAFE_INTENTS: CommentIntent[] = ["frage_faq", "lob"];

export const SENTIMENTS = ["positiv", "neutral", "negativ"] as const;

export type RouteAction = "public_reply" | "private_or_human" | "hide" | "skip";

export const ROUTE_LABEL: Record<RouteAction, string> = {
  public_reply: "Öffentliche Antwort",
  private_or_human: "Privat / an Mensch",
  hide: "Ausblenden/markieren",
  skip: "Ignorieren",
};

/** Routing nach Intent. Beschwerde/bestellbezogen NIE öffentlich automatisch. */
export function routeForIntent(intent: CommentIntent): RouteAction {
  switch (intent) {
    case "frage_faq":
    case "lob":
      return "public_reply";
    case "beschwerde":
    case "bestellbezogen":
      return "private_or_human";
    case "spam":
    case "troll":
      return "hide";
    default:
      return "skip";
  }
}

export function isAutoSafe(intent: CommentIntent): boolean {
  return AUTO_SAFE_INTENTS.includes(intent);
}

export function normalizeIntent(s: string | null | undefined): CommentIntent {
  if (s && (COMMENT_INTENTS as readonly string[]).includes(s)) return s as CommentIntent;
  return "offtopic";
}

/** Wie viele erfolgreiche Freigaben einer Kategorie, bevor sie auf Auto darf. */
export const AUTONOMY_THRESHOLD = 10;
/** Mindest-Sicherheit (Confidence) für eine automatische öffentliche Antwort. */
export const AUTO_CONFIDENCE_MIN = 80;
