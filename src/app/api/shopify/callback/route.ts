// Shopify-OAuth-Callback (Authorization Code). Läuft lokal: der Browser landet nach der
// Autorisierung hier (localhost), wir tauschen den Code gegen einen Offline-Token.
import { cookies } from "next/headers";
import { exchangeShopifyCode } from "@/server/shopify-config";

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shop = url.searchParams.get("shop") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  const store = await cookies();
  const saved = store.get("shopify_oauth_state")?.value ?? "";
  const [shopId, savedState] = saved.split(":");

  const fail = (msg: string, id?: string) =>
    Response.redirect(
      `${appUrl()}/admin/shops/${id ?? ""}?tab=zugang&shopify_error=${encodeURIComponent(msg)}`,
      302,
    );

  if (!shop || !code) return fail("Fehlende Parameter", shopId);
  if (!shopId || !savedState || savedState !== state) return fail("Ungültiger State (neu starten)", shopId);

  try {
    await exchangeShopifyCode(shopId, shop, code);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), shopId);
  }

  return Response.redirect(`${appUrl()}/admin/shops/${shopId}?tab=zugang&shopify=ok`, 302);
}
