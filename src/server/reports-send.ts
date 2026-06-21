// Wochenbericht erzeugen und versenden (von Action "jetzt testen" UND Worker-Cron genutzt).
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { classifyShopTickets } from "@/server/ai/classify";
import { fullReport } from "@/server/reports";
import { buildWeeklyEmail } from "@/server/reports-email";
import { sendMailViaShop } from "@/server/mailer";

function parseRecipients(raw: string | null): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendWeeklyReport(shopId: string, days = 7): Promise<{ to: string[] }> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new Error("Shop nicht gefunden");
  const recipients = parseRecipients(shop.weeklyReportTo);
  if (!recipients.length) throw new Error("Keine Empfänger konfiguriert (Admin → Shop → Wochenbericht).");

  // Erst klassifizieren, damit Themen/Frühwarnungen gefüllt sind (nur wenn KI konfiguriert).
  if (aiConfigured()) {
    let guard = 0;
    while (guard++ < 6) {
      const r = await classifyShopTickets(shopId, days);
      if (r.classified === 0 || r.remaining === 0) break;
    }
  }

  const report = await fullReport(shopId, days);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { subject, text, html } = buildWeeklyEmail(shop.name, appUrl, report);
  await sendMailViaShop(shopId, { to: recipients, subject, text, html });
  return { to: recipients };
}
