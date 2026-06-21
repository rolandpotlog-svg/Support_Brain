"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireShopsEdit, requireUser } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";
import { loadSocialCreds } from "@/server/social-config";
import { loadShopifyCreds } from "@/server/shopify-config";
import { sendMetaMessage } from "@/server/social/meta";
import { findCustomersByName, type ShopifyCustomer } from "@/lib/shopify/client";

/** Meta-Account (FB-Seite / IG-Konto) je Shop anlegen/aktualisieren. Token leer = behalten. */
export async function saveSocialAccount(formData: FormData) {
  await requireShopsEdit();
  const shopId = String(formData.get("shopId") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const pageId = String(formData.get("pageId") ?? "").trim();
  const pageName = String(formData.get("pageName") ?? "").trim() || null;
  const accessToken = String(formData.get("accessToken") ?? "").trim();
  const appSecret = String(formData.get("appSecret") ?? "").trim();
  const verifyToken = String(formData.get("verifyToken") ?? "").trim();
  if (!shopId || (channel !== "facebook" && channel !== "instagram")) throw new Error("Ungültiger Kanal");
  if (!pageId) throw new Error("Page-/Account-ID nötig");

  const existing = await db.query.socialAccount.findFirst({
    where: and(eq(schema.socialAccount.shopId, shopId), eq(schema.socialAccount.channel, channel)),
  });
  if (!accessToken && !existing) throw new Error("Access-Token nötig");

  const accessTokenEnc = accessToken ? encrypt(accessToken) : existing!.accessTokenEnc;
  const appSecretEnc = appSecret ? encrypt(appSecret) : existing?.appSecretEnc ?? null;
  const vToken = verifyToken || existing?.verifyToken || null;

  await db
    .insert(schema.socialAccount)
    .values({ shopId, channel, pageId, pageName, accessTokenEnc, appSecretEnc, verifyToken: vToken })
    .onConflictDoUpdate({
      target: [schema.socialAccount.shopId, schema.socialAccount.channel],
      set: { pageId, pageName, accessTokenEnc, appSecretEnc, verifyToken: vToken, updatedAt: new Date() },
    });
  revalidatePath(`/admin/shops/${shopId}`);
}

export async function deleteSocialAccount(accountId: string) {
  await requireShopsEdit();
  const a = await db.query.socialAccount.findFirst({ where: eq(schema.socialAccount.id, accountId) });
  if (!a) return;
  await db.delete(schema.socialAccount).where(eq(schema.socialAccount.id, accountId));
  revalidatePath(`/admin/shops/${a.shopId}`);
}

/** Draft-First-Antwort senden (Mensch gibt frei). Geht über die Meta API raus. */
export async function sendSocialReply(conversationId: string, text: string) {
  const user = await requireUser();
  if (!text.trim()) throw new Error("Leere Nachricht");
  const conv = await db.query.socialConversation.findFirst({
    where: eq(schema.socialConversation.id, conversationId),
  });
  if (!conv) throw new Error("Konversation nicht gefunden");
  await assertShopAccess(user, conv.shopId);

  const creds = await loadSocialCreds(conv.accountId);
  if (!creds) throw new Error("Meta-Account nicht konfiguriert");

  const res = await sendMetaMessage(creds, conv.externalUserId, text);
  await db.insert(schema.socialMessage).values({
    conversationId,
    direction: "outbound",
    text,
    externalId: res.messageId || null,
    sentBy: user.id,
  });
  await db
    .update(schema.socialConversation)
    .set({ lastMessageAt: new Date() })
    .where(eq(schema.socialConversation.id, conversationId));
  revalidatePath("/social");
}

/** Kundenabgleich (best-effort, meist nur über den Namen). Niemals stillschweigend zuordnen. */
export async function findSocialCandidates(conversationId: string): Promise<ShopifyCustomer[]> {
  const user = await requireUser();
  const conv = await db.query.socialConversation.findFirst({
    where: eq(schema.socialConversation.id, conversationId),
  });
  if (!conv) return [];
  await assertShopAccess(user, conv.shopId);
  const creds = await loadShopifyCreds(conv.shopId);
  if (!creds || !conv.userName) return [];
  try {
    return await findCustomersByName(creds, conv.userName);
  } catch {
    return [];
  }
}

export async function linkSocialCustomer(conversationId: string, customer: ShopifyCustomer) {
  const user = await requireUser();
  const conv = await db.query.socialConversation.findFirst({
    where: eq(schema.socialConversation.id, conversationId),
  });
  if (!conv) throw new Error("Konversation nicht gefunden");
  await assertShopAccess(user, conv.shopId);
  await db
    .update(schema.socialConversation)
    .set({ customerName: customer.displayName, customerEmail: customer.email ?? null })
    .where(eq(schema.socialConversation.id, conversationId));
  revalidatePath("/social");
}

export async function unlinkSocialCustomer(conversationId: string) {
  const user = await requireUser();
  const conv = await db.query.socialConversation.findFirst({
    where: eq(schema.socialConversation.id, conversationId),
  });
  if (!conv) throw new Error("Konversation nicht gefunden");
  await assertShopAccess(user, conv.shopId);
  await db
    .update(schema.socialConversation)
    .set({ customerName: null, customerEmail: null, orderId: null, orderName: null })
    .where(eq(schema.socialConversation.id, conversationId));
  revalidatePath("/social");
}
