"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireAdmin } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";
import { hashPassword } from "@/lib/password";

/** Store-Domain normalisieren: ohne Protokoll, ohne abschließenden Slash. */
function cleanDomain(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export async function createUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "agent");
  const password = String(formData.get("password") ?? "");
  const shopIds = formData.getAll("shopIds").map(String);
  if (!email || !password) throw new Error("E-Mail und Passwort nötig");
  if (role !== "agent" && role !== "admin") throw new Error("Ungültige Rolle");

  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({ email, name, role: role as "agent" | "admin", passwordHash: hashPassword(password) })
      .returning({ id: schema.users.id });
    for (const shopId of shopIds) {
      await tx.insert(schema.userShops).values({ userId: u.id, shopId });
    }
  });
  revalidatePath("/admin");
}

export async function createShop(formData: FormData) {
  await requireAdmin();
  const slug = String(formData.get("slug") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!slug || !name) throw new Error("Slug und Name nötig");

  const imapHost = String(formData.get("imapHost") ?? "").trim();
  const hasMailbox = imapHost.length > 0;

  const shopifyDomain = cleanDomain(String(formData.get("shopifyDomain") ?? ""));
  const shopifyToken = String(formData.get("shopifyToken") ?? "").trim();
  const hasShopify = shopifyDomain.length > 0 && shopifyToken.length > 0;

  await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(schema.shops)
      .values({ slug, name })
      .returning({ id: schema.shops.id });
    if (hasMailbox) {
      await tx.insert(schema.shopMailboxes).values({
        shopId: s.id,
        imapHost,
        imapPort: Number(formData.get("imapPort") ?? 993),
        imapUser: String(formData.get("imapUser") ?? ""),
        imapPasswordEnc: encrypt(String(formData.get("imapPassword") ?? "")),
        smtpHost: String(formData.get("smtpHost") ?? ""),
        smtpPort: Number(formData.get("smtpPort") ?? 465),
        smtpUser: String(formData.get("smtpUser") ?? ""),
        smtpPasswordEnc: encrypt(String(formData.get("smtpPassword") ?? "")),
        fromEmail: String(formData.get("fromEmail") ?? ""),
        fromName: String(formData.get("fromName") ?? "") || null,
      });
    }
    if (hasShopify) {
      await tx.insert(schema.shopShopify).values({
        shopId: s.id,
        storeDomain: shopifyDomain,
        adminTokenEnc: encrypt(shopifyToken),
      });
    }
  });
  revalidatePath("/admin");
}

/** Shopify-Zugang eines Shops setzen/aktualisieren. Token leer = bestehenden behalten. */
export async function setShopifyConfig(formData: FormData) {
  await requireAdmin();
  const shopId = String(formData.get("shopId") ?? "");
  const domain = cleanDomain(String(formData.get("storeDomain") ?? ""));
  const token = String(formData.get("adminToken") ?? "").trim();
  if (!shopId) throw new Error("Shop fehlt");
  if (!domain) throw new Error("Store-Domain nötig (z. B. deinshop.myshopify.com)");

  const existing = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
  });
  if (!token && !existing) throw new Error("Admin-API-Token nötig");
  const adminTokenEnc = token ? encrypt(token) : existing!.adminTokenEnc;

  await db
    .insert(schema.shopShopify)
    .values({ shopId, storeDomain: domain, adminTokenEnc })
    .onConflictDoUpdate({
      target: schema.shopShopify.shopId,
      set: { storeDomain: domain, adminTokenEnc, updatedAt: new Date() },
    });
  revalidatePath("/admin");
}

export async function setKillSwitch(shopId: string, on: boolean) {
  await requireAdmin();
  await db.update(schema.shops).set({ killSwitch: on }).where(eq(schema.shops.id, shopId));
  revalidatePath("/admin");
  revalidatePath("/inbox");
}
