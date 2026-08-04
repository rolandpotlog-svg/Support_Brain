// Speicherplatz-Diagnose: was frisst wie viel in der Datenbank?
//   Ausführen (Render-Shell):  npx tsx scripts/db-usage.ts
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/server/db/index";

/* eslint-disable @typescript-eslint/no-explicit-any */
function rows(res: any): any[] {
  return res?.rows ?? res ?? [];
}

async function main() {
  const total = rows(await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`));
  console.log("=== DB gesamt:", total[0]?.size, "===\n");

  console.log("--- Größte Tabellen ---");
  const tables = rows(
    await db.execute(sql`
      SELECT relname AS tabelle,
             pg_size_pretty(pg_total_relation_size(relid)) AS groesse
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 12`),
  );
  for (const t of tables) console.log(`  ${String(t.tabelle).padEnd(24)} ${t.groesse}`);

  console.log("\n--- Anhänge (Fotos etc. in der DB) ---");
  const att = rows(
    await db.execute(sql`SELECT count(*)::int AS n, pg_size_pretty(coalesce(sum(size_bytes),0)) AS gesamt FROM message_attachment`),
  );
  console.log(`  ${att[0]?.n ?? 0} Anhänge, gesamt ${att[0]?.gesamt ?? "0 B"}`);

  console.log("\n--- Mail-HTML (bodyHtml) ---");
  const html = rows(
    await db.execute(sql`SELECT count(*)::int AS n, pg_size_pretty(coalesce(sum(length(body_html)),0)) AS gesamt FROM messages WHERE body_html IS NOT NULL`),
  );
  console.log(`  ${html[0]?.n ?? 0} Nachrichten mit HTML, gesamt ${html[0]?.gesamt ?? "0 B"}`);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
