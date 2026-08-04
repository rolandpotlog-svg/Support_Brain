// Dünner CLI-Wrapper: setzt KI-Profil + Schnellantworten für einen Brand (Inhalt in src/server/seed-defaults.ts).
//   npx tsx scripts/seed-profile.ts <slug>
// (Einfacher geht's über den Knopf: Admin -> Brands -> Brand -> Shop-Profil -> "Standard laden".)
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { applyBrandDefaults } from "../src/server/seed-defaults";

async function main() {
  const slug = (process.argv[2] ?? "").toLowerCase();
  if (!slug) {
    console.error("Aufruf: npx tsx scripts/seed-profile.ts <slug>   (z. B. repello)");
    process.exit(1);
  }
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.slug, slug) });
  if (!shop) {
    console.error(`Shop mit Slug "${slug}" nicht gefunden. Vorhandene Slugs siehe Admin -> Brands.`);
    process.exit(1);
  }
  const r = await applyBrandDefaults(shop.id);
  console.log(`${r.brand}: KI-Profil gesetzt + ${r.replies} Schnellantworten (${r.set}).`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
