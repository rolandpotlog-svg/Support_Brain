// Lese-Helfer für die Shop-Verwaltung (Admin). Liefert NIE Klartext-Secrets —
// nur "gesetzt/nicht gesetzt". Schreibende Logik liegt in actions/shops.ts.
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type ShopStatusRow = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  shopifyConfigured: boolean;
  mailboxCount: number;
};

/** Übersicht aller Shops inkl. Verbindungs-Status (für Admin → Shops). */
export async function listShopsWithStatus(): Promise<ShopStatusRow[]> {
  const shops = await db.select().from(schema.shops).orderBy(schema.shops.name);
  const shopifyRows = await db
    .select({ shopId: schema.shopShopify.shopId })
    .from(schema.shopShopify);
  const shopifySet = new Set(shopifyRows.map((r) => r.shopId));
  const mbRows = await db
    .select({ shopId: schema.shopMailboxes.shopId, c: count() })
    .from(schema.shopMailboxes)
    .groupBy(schema.shopMailboxes.shopId);
  const mbMap = new Map(mbRows.map((r) => [r.shopId, Number(r.c)]));

  return shops.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    active: s.active,
    shopifyConfigured: shopifySet.has(s.id),
    mailboxCount: mbMap.get(s.id) ?? 0,
  }));
}

export type MailboxView = {
  id: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  fromEmail: string;
  fromName: string | null;
  shadowMode: boolean;
  passwordsSet: boolean; // bestehende Postfächer haben immer Passwörter gesetzt
};

export type ShopDetail = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  weeklyReportEnabled: boolean;
  weeklyReportTo: string;
  autoTag: boolean;
  autoDraft: boolean;
  shopify: {
    configured: boolean;
    domain: string | null;
    clientId: string | null;
    hasClientSecret: boolean;
    hasLegacyToken: boolean;
  };
  mailboxes: MailboxView[];
};

/** Shop-Detail für das Bearbeiten-Formular — ohne Passwörter/Token. */
export async function loadShopForEdit(shopId: string): Promise<ShopDetail | null> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) return null;

  const sh = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
    columns: { storeDomain: true, clientId: true, clientSecretEnc: true, adminTokenEnc: true },
  });

  const mbs = await db
    .select({
      id: schema.shopMailboxes.id,
      imapHost: schema.shopMailboxes.imapHost,
      imapPort: schema.shopMailboxes.imapPort,
      imapUser: schema.shopMailboxes.imapUser,
      smtpHost: schema.shopMailboxes.smtpHost,
      smtpPort: schema.shopMailboxes.smtpPort,
      smtpUser: schema.shopMailboxes.smtpUser,
      fromEmail: schema.shopMailboxes.fromEmail,
      fromName: schema.shopMailboxes.fromName,
      shadowMode: schema.shopMailboxes.shadowMode,
    })
    .from(schema.shopMailboxes)
    .where(eq(schema.shopMailboxes.shopId, shopId))
    .orderBy(schema.shopMailboxes.fromEmail);

  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    active: shop.active,
    weeklyReportEnabled: shop.weeklyReportEnabled,
    weeklyReportTo: shop.weeklyReportTo ?? "",
    autoTag: shop.autoTag,
    autoDraft: shop.autoDraft,
    shopify: {
      configured: Boolean(sh),
      domain: sh?.storeDomain ?? null,
      clientId: sh?.clientId ?? null,
      hasClientSecret: Boolean(sh?.clientSecretEnc),
      hasLegacyToken: Boolean(sh?.adminTokenEnc),
    },
    mailboxes: mbs.map((m) => ({ ...m, passwordsSet: true })),
  };
}
