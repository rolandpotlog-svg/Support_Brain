// DB-Platz zurückgewinnen: HTML-Volltexte in Klartext umwandeln + löschen, optional alte
// Anhänge prunen, dann VACUUM FULL (gibt Speicher an Render zurück).
//   Ausführen (Render-Shell):
//     npx tsx scripts/reclaim-db.ts            -> nur HTML aufräumen
//     npx tsx scripts/reclaim-db.ts 90         -> zusätzlich Anhänge älter als 90 Tage löschen
import "dotenv/config";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { htmlToPlainText } from "../src/lib/mailbox/html-text";

async function main() {
  const pruneDays = Number(process.argv[2] ?? 0);

  // 1) Fehlenden Klartext aus HTML nachtragen (Inhalt bewahren!), bevor HTML gelöscht wird.
  const missing = await db
    .select({ id: schema.messages.id, bodyHtml: schema.messages.bodyHtml })
    .from(schema.messages)
    .where(
      and(
        isNotNull(schema.messages.bodyHtml),
        or(isNull(schema.messages.bodyText), eq(schema.messages.bodyText, "")),
      ),
    );
  for (const m of missing) {
    if (m.bodyHtml) {
      await db.update(schema.messages).set({ bodyText: htmlToPlainText(m.bodyHtml) }).where(eq(schema.messages.id, m.id));
    }
  }
  console.log(`Klartext aus HTML nachgetragen: ${missing.length} Nachricht(en).`);

  // 2) Rohes HTML entfernen (Klartext ist jetzt überall vorhanden).
  const htmlRes: any = await db.execute(sql`UPDATE messages SET body_html = NULL WHERE body_html IS NOT NULL`);
  console.log(`HTML entfernt: ${htmlRes?.rowCount ?? "?"} Nachricht(en).`);

  // 3) Optional: alte Anhänge löschen.
  if (pruneDays > 0) {
    const attRes: any = await db.execute(
      sql`DELETE FROM message_attachment WHERE created_at < now() - make_interval(days => ${pruneDays})`,
    );
    console.log(`Anhänge älter als ${pruneDays} Tage gelöscht: ${attRes?.rowCount ?? "?"}.`);
  }

  // 4) Speicher an das Betriebssystem/Render zurückgeben (kann kurz die Tabelle sperren).
  console.log("VACUUM FULL läuft…");
  await db.execute(sql`VACUUM FULL messages`);
  await db.execute(sql`VACUUM FULL message_attachment`);
  console.log("Fertig — Platz freigegeben.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
