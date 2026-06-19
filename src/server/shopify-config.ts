// Shopify-Zugang pro Shop. Zwei Wege:
//  - Client-Credentials-Grant (Dev-Dashboard-App): Tool holt den Token selbst und cached ihn (24 h).
//  - Legacy: manuell hinterlegter shpat_-Admin-API-Token.
// Klartext (Token/Secret) verlässt nie die Serverschicht.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt, encrypt } from "@/lib/mailbox/crypto";
import type { ShopifyCreds } from "@/lib/shopify/client";

/** Token über den Client-Credentials-Grant holen. Wirft mit klarer Meldung bei Fehlern. */
async function fetchCcgToken(
  domain: string,
  clientId: string,
  clientSecret: string,
): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token-Endpoint HTTP ${res.status} — Store-Domain korrekt (xxx.myshopify.com)?`);
  }
  if (!res.ok || typeof json.access_token !== "string") {
    throw new Error(
      String(json.error_description || json.error || `Token-Endpoint HTTP ${res.status}`),
    );
  }
  return { token: json.access_token, expiresIn: Number(json.expires_in) || 86399 };
}

/** Entschlüsselte Credentials eines Shops oder null. Holt/erneuert den CCG-Token bei Bedarf. */
export async function loadShopifyCreds(shopId: string): Promise<ShopifyCreds | null> {
  const row = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
  });
  if (!row) return null;

  // Client-Credentials-Grant
  if (row.clientId && row.clientSecretEnc) {
    const cached =
      row.adminTokenEnc && row.tokenExpiresAt && row.tokenExpiresAt.getTime() > Date.now() + 60_000;
    if (cached) return { domain: row.storeDomain, token: decrypt(row.adminTokenEnc!) };

    const { token, expiresIn } = await fetchCcgToken(
      row.storeDomain,
      row.clientId,
      decrypt(row.clientSecretEnc),
    );
    await db
      .update(schema.shopShopify)
      .set({
        adminTokenEnc: encrypt(token),
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopShopify.shopId, shopId));
    return { domain: row.storeDomain, token };
  }

  // Legacy-Token
  if (row.adminTokenEnc) return { domain: row.storeDomain, token: decrypt(row.adminTokenEnc) };
  return null;
}

/** Status für die Admin-UI (ohne Token-Klartext). */
export async function shopifyStatus(
  shopId: string,
): Promise<{ configured: boolean; domain: string | null; mode: "ccg" | "legacy" | null }> {
  const row = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
    columns: { storeDomain: true, adminTokenEnc: true, clientId: true, clientSecretEnc: true },
  });
  if (!row) return { configured: false, domain: null, mode: null };
  const ccg = Boolean(row.clientId && row.clientSecretEnc);
  return {
    configured: ccg || Boolean(row.adminTokenEnc),
    domain: row.storeDomain,
    mode: ccg ? "ccg" : row.adminTokenEnc ? "legacy" : null,
  };
}
