// Meta-Zugangsdaten je Shop: laden (entschlüsselt) + Webhook-Routing. Tokens liegen
// AES-256-GCM-verschlüsselt; Klartext verlässt nie die Serverschicht.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";

export type SocialAccountView = {
  id: string;
  channel: string;
  pageId: string;
  pageName: string | null;
  configured: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
};

/** Accounts eines Shops für das Admin-Formular (ohne Secrets). */
export async function loadSocialAccounts(shopId: string): Promise<SocialAccountView[]> {
  const rows = await db
    .select({
      id: schema.socialAccount.id,
      channel: schema.socialAccount.channel,
      pageId: schema.socialAccount.pageId,
      pageName: schema.socialAccount.pageName,
      appSecretEnc: schema.socialAccount.appSecretEnc,
      verifyToken: schema.socialAccount.verifyToken,
    })
    .from(schema.socialAccount)
    .where(eq(schema.socialAccount.shopId, shopId));
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    pageId: r.pageId,
    pageName: r.pageName,
    configured: true,
    hasAppSecret: Boolean(r.appSecretEnc),
    hasVerifyToken: Boolean(r.verifyToken),
  }));
}

export type SocialCreds = {
  id: string;
  shopId: string;
  channel: string;
  pageId: string;
  accessToken: string;
  appSecret: string | null;
};

/** Entschlüsselte Credentials für den Versand. */
export async function loadSocialCreds(accountId: string): Promise<SocialCreds | null> {
  const a = await db.query.socialAccount.findFirst({
    where: eq(schema.socialAccount.id, accountId),
  });
  if (!a) return null;
  return {
    id: a.id,
    shopId: a.shopId,
    channel: a.channel,
    pageId: a.pageId,
    accessToken: decrypt(a.accessTokenEnc),
    appSecret: a.appSecretEnc ? decrypt(a.appSecretEnc) : null,
  };
}

/** Webhook-Routing: Account anhand der Page-/IG-ID (entschlüsselt). */
export async function accountByPageId(pageId: string): Promise<SocialCreds | null> {
  const a = await db.query.socialAccount.findFirst({
    where: eq(schema.socialAccount.pageId, pageId),
  });
  if (!a) return null;
  return {
    id: a.id,
    shopId: a.shopId,
    channel: a.channel,
    pageId: a.pageId,
    accessToken: decrypt(a.accessTokenEnc),
    appSecret: a.appSecretEnc ? decrypt(a.appSecretEnc) : null,
  };
}

/** Webhook-GET-Handshake: stimmt der Verify-Token mit irgendeinem Account überein? */
export async function verifyTokenMatches(token: string): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .select({ verifyToken: schema.socialAccount.verifyToken })
    .from(schema.socialAccount);
  return rows.some((r) => r.verifyToken && r.verifyToken === token);
}
