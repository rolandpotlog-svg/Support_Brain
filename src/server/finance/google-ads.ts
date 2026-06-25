// Google-Ads-Verbindung je Brand: speichern (verschlüsselt, validiert) + Kosten je
// Woche in financeMarketing (Kanal "google") schreiben.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { encrypt, decrypt } from "@/lib/mailbox/crypto";
import { getDailyCost, checkConfig, type GoogleAdsConfig } from "@/lib/google/ads";
import { weekOf } from "@/lib/finance/week";

export type GoogleAdsView = {
  configured: boolean;
  customerId: string;
  loginCustomerId: string;
  clientId: string;
  updatedAt: Date | null;
};

export async function loadGoogleAds(shopId: string): Promise<GoogleAdsView> {
  const r = await db.query.financeGoogleAds.findFirst({ where: eq(schema.financeGoogleAds.shopId, shopId) });
  return {
    configured: Boolean(r),
    customerId: r?.customerId ?? "",
    loginCustomerId: r?.loginCustomerId ?? "",
    clientId: r?.clientId ?? "",
    updatedAt: r?.updatedAt ?? null,
  };
}

function toCfg(row: typeof schema.financeGoogleAds.$inferSelect): GoogleAdsConfig {
  return {
    customerId: row.customerId,
    loginCustomerId: row.loginCustomerId,
    clientId: row.clientId,
    clientSecret: decrypt(row.clientSecretEnc),
    developerToken: decrypt(row.developerTokenEnc),
    refreshToken: decrypt(row.refreshTokenEnc),
  };
}

export type GoogleAdsInput = {
  customerId: string;
  loginCustomerId?: string;
  clientId: string;
  clientSecret?: string;
  developerToken?: string;
  refreshToken?: string;
};

export async function saveGoogleAds(shopId: string, input: GoogleAdsInput): Promise<void> {
  const existing = await db.query.financeGoogleAds.findFirst({ where: eq(schema.financeGoogleAds.shopId, shopId) });
  const clientSecret = input.clientSecret?.trim() || (existing ? decrypt(existing.clientSecretEnc) : "");
  const developerToken = input.developerToken?.trim() || (existing ? decrypt(existing.developerTokenEnc) : "");
  const refreshToken = input.refreshToken?.trim() || (existing ? decrypt(existing.refreshTokenEnc) : "");
  const customerId = input.customerId.trim();
  const clientId = input.clientId.trim();
  const loginCustomerId = input.loginCustomerId?.trim() || null;
  if (!customerId || !clientId || !clientSecret || !developerToken || !refreshToken) {
    throw new Error("Alle Felder nötig (Secrets musst du nur beim ersten Mal eingeben).");
  }

  const cfg: GoogleAdsConfig = { customerId, loginCustomerId, clientId, clientSecret, developerToken, refreshToken };
  const check = await checkConfig(cfg);
  if (!check.ok) throw new Error(`Verbindung fehlgeschlagen: ${check.error}`);

  const vals = {
    customerId,
    loginCustomerId,
    clientId,
    clientSecretEnc: encrypt(clientSecret),
    developerTokenEnc: encrypt(developerToken),
    refreshTokenEnc: encrypt(refreshToken),
    updatedAt: new Date(),
  };
  await db
    .insert(schema.financeGoogleAds)
    .values({ shopId, ...vals })
    .onConflictDoUpdate({ target: schema.financeGoogleAds.shopId, set: vals });
}

export async function ingestGoogleSpend(shopId: string, since: string, until: string): Promise<{ weeks: number; totalCents: number }> {
  const row = await db.query.financeGoogleAds.findFirst({ where: eq(schema.financeGoogleAds.shopId, shopId) });
  if (!row) throw new Error("Google Ads nicht verbunden");

  const daily = await getDailyCost(toCfg(row), since, until);
  const byWeek = new Map<string, number>();
  for (const d of daily) {
    const { weekStart } = weekOf(new Date(`${d.date}T12:00:00Z`));
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + d.costCents);
  }

  let totalCents = 0;
  for (const [weekStart, amountCents] of byWeek) {
    totalCents += amountCents;
    await db
      .insert(schema.financeMarketing)
      .values({ shopId, weekStart, channel: "google", amountCents })
      .onConflictDoUpdate({
        target: [schema.financeMarketing.shopId, schema.financeMarketing.weekStart, schema.financeMarketing.channel],
        set: { amountCents, updatedAt: new Date() },
      });
  }
  return { weeks: byWeek.size, totalCents };
}
