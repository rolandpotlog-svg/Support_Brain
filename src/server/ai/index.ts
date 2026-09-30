// Provider-agnostische KI-Schnittstelle. Default: Claude (Anthropic). Austauschbar —
// der Rest der App ruft nur complete() auf und weiß nichts vom Provider.
import Anthropic from "@anthropic-ai/sdk";

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY ist nicht gesetzt (in .env eintragen).");
  }
  client ??= new Anthropic();
  return client;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Modelle: „standard“ = Claude Sonnet 5.5 (Entwürfe, Urteile), „schnell“ = Claude Haiku 4.5 (Einordnung).
// Preise je 1 Mio. Tokens in USD: Eingabe / Ausgabe / Cache-Lesen / Cache-Schreiben (5 Min.).
const MODELS = {
  standard: { id: "claude-sonnet-5-5", price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
  schnell: { id: "claude-haiku-4-5", price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  stark: { id: "claude-opus-5-5", price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
} as const;
type ModelKey = keyof typeof MODELS;

/** Eine Antwort vom Modell. system = Anweisungen/Shop-Gehirn, messages = Verlauf/Kontext.
 *  Der System-Prompt wird gecacht (gleicher Shop = gleiche Regeln): ~90 % günstiger + schneller ab dem 2. Aufruf.
 *  Jeder Aufruf wird mit Tokens, Kosten und Dauer protokolliert (ai_usage). */
export async function complete(opts: {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  kind?: string;
  shopId?: string | null;
  model?: ModelKey;
}): Promise<string> {
  const m = MODELS[opts.model ?? "standard"];
  const t0 = Date.now();
  const res = await getClient().messages.create({
    model: m.id,
    max_tokens: opts.maxTokens ?? 3000,
    // Haiku 4.5: kein adaptives Denken / kein effort (würde 400 liefern) — für Einordnung nicht nötig.
    ...(opts.model === "schnell"
      ? {}
      : { thinking: { type: "adaptive" as const }, output_config: { effort: opts.effort ?? "medium" } }),
    // Als Block mit cache_control: zu kurze System-Prompts werden vom API einfach nicht gecacht (kein Fehler).
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages,
  });
  void logUsage(opts.kind ?? "sonstiges", opts.shopId ?? null, m.id, m.price, res.usage, Date.now() - t0);
  // Sicherheits-Ablehnung (sehr selten): nicht als leeren Entwurf speichern, sondern als Fehler melden.
  if (res.stop_reason === "refusal") throw new Error("KI hat die Anfrage abgelehnt (Sicherheitsfilter) — bitte manuell beantworten");
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}

export type Classification = { ref: number; category: string; sentiment: string; product: string | null };

/** Klassifiziert mehrere Anfragen in einem Aufruf (feste Kategorien/Sentiment + Produkt). */
export async function classifyBatch(
  items: { ref: number; subject: string; body: string }[],
  categories: readonly string[],
  sentiments: readonly string[],
): Promise<Classification[]> {
  if (!items.length) return [];
  const list = items.map((it) => `#${it.ref}\nBetreff: ${it.subject}\nText: ${it.body}`).join("\n\n");
  const system =
    "Du klassifizierst E-Commerce-Kundensupport-Anfragen. Antworte AUSSCHLIESSLICH mit einem JSON-Array — " +
    "kein Markdown, keine Code-Fences, keine Erklärung.";
  const user =
    `Wähle je Anfrage genau EINE Kategorie aus: ${categories.join(" | ")}\n` +
    `Wähle genau EIN Sentiment aus: ${sentiments.join(" | ")}\n` +
    `product: konkret genanntes Produkt (kurz), sonst null.\n\n` +
    `Antworte als JSON-Array, ein Objekt je Anfrage, exakt in diesem Format:\n` +
    `[{"ref":1,"category":"…","sentiment":"…","product":null}]\n\n` +
    `ANFRAGEN:\n${list}`;
  const raw = await complete({ system, messages: [{ role: "user", content: user }], maxTokens: 4000 });
  const a = raw.indexOf("[");
  const b = raw.lastIndexOf("]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((p) => {
    const o = p as Record<string, unknown>;
    return {
      ref: Number(o.ref),
      category: String(o.category ?? ""),
      sentiment: String(o.sentiment ?? ""),
      product: o.product ? String(o.product) : null,
    };
  });
}

/** Verbrauch protokollieren — darf den eigentlichen Aufruf nie stören. */
async function logUsage(
  kind: string,
  shopId: string | null,
  model: string,
  price: { input: number; output: number; cacheRead: number; cacheWrite: number },
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null },
  ms: number,
): Promise<void> {
  try {
    const { db, schema } = await import("@/server/db");
    const cr = u.cache_read_input_tokens ?? 0;
    const cw = u.cache_creation_input_tokens ?? 0;
    const usd =
      (u.input_tokens * price.input + u.output_tokens * price.output + cr * price.cacheRead + cw * price.cacheWrite) / 1_000_000;
    await db.insert(schema.aiUsage).values({
      shopId,
      kind,
      model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: cr,
      cacheWriteTokens: cw,
      costMicroUsd: Math.round(usd * 1_000_000),
      durationMs: ms,
    });
  } catch {
    /* Protokoll ist optional */
  }
}
