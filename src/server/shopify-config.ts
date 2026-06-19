// Shopify-Zugang pro Shop: laden (entschlüsselt) + Status. Token liegt
// AES-256-GCM-verschlüsselt in shop_shopify; Klartext verlässt nie die Serverschicht.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";
import type { ShopifyCreds } from "@/lib/shopify/client";

/** Entschlüsselte Credentials eines Shops oder null, wenn nicht konfiguriert. */
export async function loadShopifyCreds(shopId: string): Promise<ShopifyCreds | null> {
  const row = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
  });
  if (!row) return null;
  return { domain: row.storeDomain, token: decrypt(row.adminTokenEnc) };
}

/** Status für die Admin-UI (ohne Token-Klartext). */
export async function shopifyStatus(
  shopId: string,
): Promise<{ configured: boolean; domain: string | null }> {
  const row = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
    columns: { storeDomain: true },
  });
  return { configured: Boolean(row), domain: row?.storeDomain ?? null };
}
