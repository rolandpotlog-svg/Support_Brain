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
}): Promise<string> {
  const res = await getClient().messages.create({
    model: "claude-opus-4-8",
    max_tokens: opts.maxTokens ?? 3000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: opts.system,
    messages: opts.messages,
  });
  return res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
}
