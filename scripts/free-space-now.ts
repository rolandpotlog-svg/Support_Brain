// Macht die Datenbank SOFORT frei — auch wenn sie fast voll ist (kein Extra-Platz nötig).
//   Ausführen (Render-Shell):  npx tsx scripts/free-space-now.ts
//
// Was passiert:
//   1) Gespeicherte Anhänge (Fotos) werden aus der DB entfernt (TRUNCATE = sofort frei).
//      -> Die Fotos bleiben in deinem echten E-Mail-Postfach erhalten; ab R2 liegen neue dort.
//   2) HTML-Volltexte -> Klartext gerettet, dann rohes HTML gelöscht.
//   3) Platz wird an Render zurückgegeben (best effort).
import "dotenv/config";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { htmlToPlainText } from "../src/lib/mailbox/html-text";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function dbSize(): Promise<string> {
  const r: any = await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
  return (r?.rows ?? r)[0]?.s ?? "?";
}

async function main() {
  console.log("DB-Größe vorher:", await dbSize());

  // 1) Anhänge sofort freigeben (TRUNCATE braucht keinen Extra-Platz).
  const before: any = await db.execute(sql`SELECT count(*)::int AS n FROM message_attachment`);
  const n = (before?.rows ?? before)[0]?.n ?? 0;
  await db.execute(sql`TRUNCATE TABLE message_attachment`);
  console.log(`Anhänge aus der DB entfernt: ${n} (bleiben im Postfach erhalten).`);

  // 2) Klartext aus HTML retten, dann HTML löschen.
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
  const htmlRes: any = await db.execute(sql`UPDATE messages SET body_html = NULL WHERE body_html IS NOT NULL`);
  console.log(`Klartext gerettet: ${missing.length} · HTML entfernt: ${htmlRes?.rowCount ?? "?"}`);

  // 3) Platz zurückgeben (best effort — falls kein Platz für VACUUM FULL, hilft schon Schritt 1+2).
  try {
    console.log("Gebe Speicher frei (VACUUM FULL)…");
    await db.execute(sql`VACUUM FULL message_attachment`);
    await db.execute(sql`VACUUM FULL messages`);
  } catch (e) {
    console.warn("VACUUM FULL übersprungen (kommt später automatisch):", e instanceof Error ? e.message : e);
  }

  console.log("DB-Größe nachher:", await dbSize());
  console.log("Fertig ✅");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
