// Verifiziert die gespeicherten CCG-Creds: Token holen + echte Abfrage. (Einmal-Tool)
import "dotenv/config";
import { db, schema } from "../src/server/db/index";
import { decrypt } from "../src/lib/mailbox/crypto";

async function main() {
  const row = (await db.select().from(schema.shopShopify))[0];
  if (!row || !row.clientId || !row.clientSecretEnc) {
    console.log("Keine CCG-Creds gespeichert.");
    process.exit(0);
  }
  const domain = row.storeDomain;
  const clientSecret = decrypt(row.clientSecretEnc);
  console.log("Domain    :", domain);
  console.log("Client-ID :", row.clientId.slice(0, 8) + "…");

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: row.clientId, client_secret: clientSecret }),
  });
  const text = await res.text();
  console.log("Token-Stat:", res.status);
  let json: Record<string, unknown>;
  try { json = JSON.parse(text); } catch { console.log("Body:", text.slice(0, 300)); process.exit(0); }

  if (typeof json.access_token === "string") {
    console.log("✓ Token erhalten. Scopes:", json.scope, "| expires_in:", json.expires_in);
    const q = await fetch(`https://${domain}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": json.access_token },
      body: JSON.stringify({ query: "{ shop { name currencyCode } orders(first:1){ nodes { id } } customers(first:1){ nodes { id } } }" }),
    });
    console.log("Daten-Query:", q.status, (await q.text()).slice(0, 350));
  } else {
    console.log("✗ Kein Token:", JSON.stringify(json).slice(0, 300));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
