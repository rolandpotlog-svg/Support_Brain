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

/** Eine Antwort vom Modell. system = Anweisungen/Shop-Gehirn, messages = Verlauf/Kontext. */
export async function complete(opts: {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<string> {
  const res = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "medium" },
    system: opts.system,
    messages: opts.messages,
  });
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
