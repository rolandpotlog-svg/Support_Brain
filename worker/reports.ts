// Wöchentlicher Bericht: für jeden aktiven Shop mit aktiviertem Wochenbericht senden.
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { sendWeeklyReport } from "../src/server/reports-send";

export async function runWeeklyReports(): Promise<void> {
  const shops = await db
    .select({ id: schema.shops.id, name: schema.shops.name })
    .from(schema.shops)
    .where(and(eq(schema.shops.active, true), eq(schema.shops.weeklyReportEnabled, true)));

  if (!shops.length) {
    console.log("[reports] Kein Shop mit aktiviertem Wochenbericht.");
    return;
  }
  for (const s of shops) {
    try {
      const { to } = await sendWeeklyReport(s.id, 7);
      console.log(`[reports] Wochenbericht ${s.name} -> ${to.join(", ")}`);
    } catch (e) {
      console.error(`[reports] ${s.name}:`, e instanceof Error ? e.message : e);
    }
  }
}
