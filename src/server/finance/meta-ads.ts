// Meta-Ads-Verbindung je Brand: speichern (verschlüsselt) + Werbeausgaben je Woche
// in financeMarketing schreiben. Nur die Meta-Kanäle (meta, meta_garten).
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { encrypt, decrypt } from "@/lib/mailbox/crypto";
import { getDailySpend, checkAdsAccount } from "@/lib/meta/ads";
import { weekOf } from "@/lib/finance/week";

export const META_CHANNELS = ["meta", "meta_garten"] as const;
export type MetaChannel = (typeof META_CHANNELS)[number];

export type AdsAccountView = { channel: string; accountId: string; configured: boolean; updatedAt: Date | null };

/** Verbindungen eines Brands (ohne Token) fürs Formular. */
export async function loadAdsAccounts(shopId: string): Promise<AdsAccountView[]> {
  const rows = await db.select().from(schema.financeAdsAccount).where(eq(schema.financeAdsAccount.shopId, shopId));
  const byChannel = new Map(rows.map((r) => [r.channel, r]));
  return META_CHANNELS.map((channel) => {
    const r = byChannel.get(channel);
    return { channel, accountId: r?.accountId ?? "", configured: Boolean(r), updatedAt: r?.updatedAt ?? null };
  });
}

/** Verbindung speichern (Token validieren + verschlüsseln). */
export async function saveAdsAccount(shopId: string, channel: string, accountId: string, token: string): Promise<{ name?: string }> {
  if (!META_CHANNELS.includes(channel as MetaChannel)) throw new Error("Ungültiger Meta-Kanal");
  const acc = accountId.trim();
  if (!acc) throw new Error("Werbekonto-ID nötig");

  const existing = await db.query.financeAdsAccount.findFirst({
    where: and(eq(schema.financeAdsAccount.shopId, shopId), eq(schema.financeAdsAccount.channel, channel)),
  });
  const useToken = token.trim() || (existing ? decrypt(existing.tokenEnc) : "");
  if (!useToken) throw new Error("Access-Token nötig");

  const check = await checkAdsAccount(useToken, acc);
  if (!check.ok) throw new Error(`Verbindung fehlgeschlagen: ${check.error}`);

  await db
    .insert(schema.financeAdsAccount)
    .values({ shopId, channel, accountId: acc, tokenEnc: encrypt(useToken) })
    .onConflictDoUpdate({
      target: [schema.financeAdsAccount.shopId, schema.financeAdsAccount.channel],
      set: { accountId: acc, tokenEnc: encrypt(useToken), updatedAt: new Date() },
    });
  return { name: check.name };
}

/** Werbeausgaben aus Meta ziehen und je Woche in financeMarketing schreiben. */
export async function ingestMetaSpend(
  shopId: string,
  channel: string,
  since: string,
  until: string,
): Promise<{ weeks: number; totalCents: number }> {
  const acc = await db.query.financeAdsAccount.findFirst({
    where: and(eq(schema.financeAdsAccount.shopId, shopId), eq(schema.financeAdsAccount.channel, channel)),
  });
  if (!acc) throw new Error("Meta-Ads für diesen Kanal nicht verbunden");

  const daily = await getDailySpend(decrypt(acc.tokenEnc), acc.accountId, since, until);
  const byWeek = new Map<string, number>();
  for (const d of daily) {
    // Tages-Audit (für Heute/Rolling-7).
    await db
      .insert(schema.financeMarketingDaily)
      .values({ shopId, channel, date: d.date, amountCents: d.spendCents })
      .onConflictDoUpdate({
        target: [schema.financeMarketingDaily.shopId, schema.financeMarketingDaily.channel, schema.financeMarketingDaily.date],
        set: { amountCents: d.spendCents, updatedAt: new Date() },
      });
    const { weekStart } = weekOf(new Date(`${d.date}T12:00:00Z`));
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + d.spendCents);
  }

  let totalCents = 0;
  for (const [weekStart, amountCents] of byWeek) {
    totalCents += amountCents;
    await db
      .insert(schema.financeMarketing)
      .values({ shopId, weekStart, channel, amountCents })
      .onConflictDoUpdate({
        target: [schema.financeMarketing.shopId, schema.financeMarketing.weekStart, schema.financeMarketing.channel],
        set: { amountCents, updatedAt: new Date() },
      });
  }
  return { weeks: byWeek.size, totalCents };
}
