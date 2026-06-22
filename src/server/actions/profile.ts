"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap } from "@/server/access";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getShopProfileData } from "@/lib/shopify/client";
import { scrapeWebsite } from "@/server/scrape";
import {
  buildSystemPrompt,
  emptyProfile,
  HUMAN_ONLY,
  type ProfileData,
  type ProfileSources,
} from "@/lib/profile/types";

async function shopName(shopId: string): Promise<string> {
  const s = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  return s?.name ?? "unser Shop";
}

function isFilled(v: unknown): boolean {
  return Array.isArray(v) ? v.length > 0 : String(v ?? "").trim() !== "";
}

/** Feld-Herkunft nach einem Speichern: ausgefüllt = bestätigt, leeres Pflichtfeld = „bitte setzen". */
function sourcesAfterSave(data: ProfileData, prev: ProfileSources): ProfileSources {
  const s: ProfileSources = { ...prev };
  for (const key of Object.keys(data) as (keyof ProfileData)[]) {
    if (isFilled(data[key])) s[key] = "confirmed";
    else if (HUMAN_ONLY.includes(key)) s[key] = "todo";
    else delete s[key];
  }
  return s;
}

async function upsertProfile(
  shopId: string,
  fields: Partial<typeof schema.shopProfile.$inferInsert>,
) {
  await db
    .insert(schema.shopProfile)
    .values({ shopId, ...fields })
    .onConflictDoUpdate({
      target: schema.shopProfile.shopId,
      set: { ...fields, updatedAt: new Date() },
    });
}

export type ShopifyRefreshResult = {
  data: ProfileData;
  sources: ProfileSources;
  summary: { productTypes: string[]; collections: number; policies: string[]; fetchedAt: string };
};
export type WebsiteRefreshResult = { scrapedAt: string; pages: { url: string; title: string }[] };

/** Profil-Felder speichern → Herkunft aktualisieren → System-Prompt neu bauen. Gibt neue Herkunft zurück. */
export async function saveProfile(shopId: string, data: ProfileData): Promise<ProfileSources> {
  await requireBrandCap(shopId, "settings");
  const existing = await db.query.shopProfile.findFirst({
    where: eq(schema.shopProfile.shopId, shopId),
  });
  const sources = sourcesAfterSave(data, existing?.sources ?? {});
  const systemPrompt = buildSystemPrompt(data, await shopName(shopId));
  await upsertProfile(shopId, {
    data,
    sources,
    systemPrompt,
    websiteUrl: data.website || existing?.websiteUrl || null,
  });
  revalidatePath(`/admin/shops/${shopId}`);
  return sources;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aus Shopify aktualisieren: Daten ziehen + leere auto-befüllbare Felder deterministisch vorbefüllen. */
export async function refreshShopifyProfile(shopId: string): Promise<ShopifyRefreshResult> {
  await requireBrandCap(shopId, "settings");
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Shop nicht konfiguriert");
  const shopify = await getShopProfileData(creds);

  const existing = await db.query.shopProfile.findFirst({
    where: eq(schema.shopProfile.shopId, shopId),
  });
  const data: ProfileData = { ...emptyProfile(), ...(existing?.data ?? {}) };
  const sources: ProfileSources = { ...(existing?.sources ?? {}) };

  const setIfEmpty = (key: keyof ProfileData, value: string) => {
    if (!isFilled(data[key]) && value.trim()) {
      (data[key] as string) = value.trim().slice(0, 1500);
      sources[key] = "auto";
    }
  };

  if (shopify.productTypes.length) {
    setIfEmpty("whatSold", `Sortiment u. a.: ${shopify.productTypes.slice(0, 8).join(", ")}`);
  }
  for (const p of shopify.policies) {
    const body = stripHtml(p.body);
    if (!body) continue;
    if (/refund|return/i.test(p.type)) {
      setIfEmpty("refund", body);
      setIfEmpty("returnPeriod", body);
    }
    if (/shipping/i.test(p.type)) setIfEmpty("shipping", body);
  }

  const fetchedAt = new Date();
  const systemPrompt = buildSystemPrompt(data, shopify.shopName);
  await upsertProfile(shopId, {
    data,
    sources,
    systemPrompt,
    shopifyData: shopify,
    shopifyFetchedAt: fetchedAt,
  });
  revalidatePath(`/admin/shops/${shopId}`);
  return {
    data,
    sources,
    summary: {
      productTypes: shopify.productTypes,
      collections: shopify.collections.length,
      policies: shopify.policies.map((p) => p.title),
      fetchedAt: fetchedAt.toISOString(),
    },
  };
}

/** Website neu analysieren (best-effort). Gescrapte Inhalte sind Entwurfsmaterial für die KI. */
export async function refreshWebsiteProfile(
  shopId: string,
  url: string,
): Promise<WebsiteRefreshResult> {
  await requireBrandCap(shopId, "settings");
  const clean = url.trim();
  if (!clean) throw new Error("Bitte eine Shop-URL angeben");
  const scraped = await scrapeWebsite(clean);
  const scrapedAt = new Date();
  await upsertProfile(shopId, {
    websiteUrl: clean,
    scrapedData: scraped,
    scrapedAt,
  });
  revalidatePath(`/admin/shops/${shopId}`);
  return {
    scrapedAt: scrapedAt.toISOString(),
    pages: scraped.pages.map((p) => ({ url: p.url, title: p.title })),
  };
}
