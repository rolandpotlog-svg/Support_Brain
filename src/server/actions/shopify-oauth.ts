"use server";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/server/db";
import { requireAdmin } from "@/server/access";

const SHOPIFY_OAUTH_SCOPES = "read_orders,read_customers,read_fulfillments,read_products";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** OAuth starten: Browser zur Shopify-Autorisierung leiten (installiert die App + liefert Code). */
export async function startShopifyOAuth(shopId: string) {
  await requireAdmin();
  const row = await db.query.shopShopify.findFirst({
    where: eq(schema.shopShopify.shopId, shopId),
  });
  if (!row?.clientId) throw new Error("Erst Domain + Client-ID + Client Secret speichern.");

  const state = randomUUID();
  const store = await cookies();
  store.set("shopify_oauth_state", `${shopId}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = `${appUrl()}/api/shopify/callback`;
  const url =
    `https://${row.storeDomain}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(row.clientId)}` +
    `&scope=${encodeURIComponent(SHOPIFY_OAUTH_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  redirect(url);
}
