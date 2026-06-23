export const CHANNELS = ["meta", "meta_garten", "google", "taboola", "tiktok"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = {
  meta: "Meta",
  meta_garten: "Meta (Garten-Expert)",
  google: "Google",
  taboola: "Taboola",
  tiktok: "TikTok",
};
