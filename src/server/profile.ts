// Lese-Helfer fürs Shop-Profil (für die Admin-Seite). Schreibende Logik: actions/profile.ts.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { emptyProfile, type ProfileData, type ProfileSources } from "@/lib/profile/types";

export type ProfileView = {
  data: ProfileData;
  sources: ProfileSources;
  systemPrompt: string;
  websiteUrl: string;
  shopifySummary:
    | { fetchedAt: string | null; productTypes: string[]; collections: number; policies: string[] }
    | null;
  scrapeSummary: { scrapedAt: string | null; pages: { url: string; title: string }[] } | null;
};

export async function loadProfile(shopId: string): Promise<ProfileView> {
  const row = await db.query.shopProfile.findFirst({
    where: eq(schema.shopProfile.shopId, shopId),
  });

  const data: ProfileData = { ...emptyProfile(), ...(row?.data ?? {}) };
  // Defensiv: Altdaten können examples/faq als null gespeichert haben -> sonst crasht das
  // Rendern (data.examples.filter / .map). Immer als Liste garantieren.
  if (!Array.isArray(data.examples)) data.examples = [];
  if (!Array.isArray(data.faq)) data.faq = [];
  const sources: ProfileSources = row?.sources ?? {};

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const shopify = row?.shopifyData as any;
  const scraped = row?.scrapedData as any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return {
    data,
    sources,
    systemPrompt: row?.systemPrompt ?? "",
    websiteUrl: row?.websiteUrl ?? "",
    shopifySummary: shopify
      ? {
          fetchedAt: row?.shopifyFetchedAt?.toISOString() ?? null,
          productTypes: shopify.productTypes ?? [],
          collections: (shopify.collections ?? []).length,
          policies: (shopify.policies ?? []).map((p: { title: string }) => p.title),
        }
      : null,
    scrapeSummary: scraped
      ? {
          scrapedAt: row?.scrapedAt?.toISOString() ?? null,
          pages: (scraped.pages ?? []).map((p: { url: string; title: string }) => ({
            url: p.url,
            title: p.title,
          })),
        }
      : null,
  };
}
