export const CHANNELS = ["meta", "meta_garten", "google", "taboola", "tiktok"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  meta: "Meta",
  meta_garten: "Meta (2. Werbekonto)",
  google: "Google",
  taboola: "Taboola",
  tiktok: "TikTok",
};

/** Kanal-Name je Shop: bei Repello ist das 2. Meta-Konto „Garten-Expert“, sonst neutral. */
export function channelLabel(c: Channel, ruleShop: boolean): string {
  if (c === "meta_garten" && ruleShop) return "Meta (Garten-Expert)";
  return CHANNEL_LABEL[c];
}
