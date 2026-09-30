"use server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireBrandCap, requireUser } from "@/server/access";
import { complete } from "@/server/ai";
import { classifyShopTickets } from "@/server/ai/classify";
import { sendWeeklyReport } from "@/server/reports-send";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { generateDraft } from "@/server/ai/draft";
import type { DraftDecision } from "@/server/ai/draft-prompt";

/**
 * KI-Antwortentwurf (Knopf im Posteingang). Draft-First: gesendet wird nur nach menschlicher Freigabe.
 * `intent` = optionale, vom Mitarbeiter gewählte Schnellantwort/Absicht, die die Antwort steuert.
 */
export async function draftReply(threadId: string, intent?: string): Promise<DraftDecision> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");
  await assertShopAccess(user, thread.shopId);
  return generateDraft(threadId, intent);
}

/** Ganzen Ticket-Verlauf knapp zusammenfassen (damit man nicht alles lesen muss). */
export async function summarizeThread(threadId: string): Promise<string> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");
  await assertShopAccess(user, thread.shopId);

  const msgs = await db
    .select({
      direction: schema.messages.direction,
      internal: schema.messages.internal,
      bodyText: schema.messages.bodyText,
      bodyHtml: schema.messages.bodyHtml,
    })
    .from(schema.messages)
    .where(eq(schema.messages.threadId, threadId))
    .orderBy(schema.messages.createdAt);

  const transcript = msgs
    .map((m) => ({ ...m, text: bestBodyText(m.bodyText, m.bodyHtml) }))
    .filter((m) => m.text)
    .map((m) => {
      const who = m.internal ? "Notiz" : m.direction === "inbound" ? thread.customerName || "Kunde" : "Support";
      return `${who}: ${m.text!.trim()}`;
    })
    .join("\n\n");
  if (!transcript) return "Kein Text zum Zusammenfassen vorhanden.";

  const system =
    "Du fasst einen Kundensupport-Verlauf für einen Mitarbeiter zusammen, damit er nicht alles lesen muss. " +
    "Antworte auf Deutsch, kurz und in Stichpunkten.";
  const userMsg =
    `Fasse den folgenden Ticket-Verlauf zusammen — in dieser Struktur:\n` +
    `• Anliegen: worum geht es?\n• Bisher: was wurde gesagt/zugesagt/getan?\n• Offen: was ist noch zu tun / unklar?\n\n` +
    `Halte es knapp.\n\nKUNDE: ${thread.customerName || ""} <${thread.customerEmail}>\n` +
    `BETREFF: ${thread.subject ?? "(kein Betreff)"}\n\nVERLAUF:\n${transcript}`;

  return complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 700, effort: "low" });
}

/** KI-Analyse der häufigsten Beschwerden im Zeitraum (für die wöchentliche Auswertung). */
export async function analyzeComplaints(shopId: string, days: number): Promise<string> {
  await requireBrandCap(shopId, "reports");
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ subject: schema.threads.subject, body: schema.messages.bodyText })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        eq(schema.messages.direction, "inbound"),
        eq(schema.messages.internal, false),
        gte(schema.messages.createdAt, since),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(300);

  if (!rows.length) return "Keine eingehenden Nachrichten im Zeitraum — nichts zu analysieren.";

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const corpus = rows
    .map(
      (r, i) =>
        `#${i + 1} Betreff: ${r.subject ?? "(kein)"}\n${(r.body ?? "").replace(/\s+/g, " ").trim().slice(0, 500)}`,
    )
    .join("\n\n");

  const system =
    "Du bist Analyst für einen E-Commerce-Kundensupport. Werte die Support-Anfragen eines Zeitraums aus " +
    "und liefere eine knappe, strukturierte Auswertung in deutschem Markdown. Erfinde nichts; stütze dich nur auf die Nachrichten.";
  const userMsg =
    `Shop: ${shop?.name ?? "?"} · Zeitraum: letzte ${days} Tage · ${rows.length} eingehende Nachrichten.\n\n` +
    "AUFGABE:\n" +
    "1. **Top-Kategorien** der Anliegen/Beschwerden als Liste, je mit geschätzter Anzahl/Anteil und 1–2 Stichworten.\n" +
    "2. **Auffälligkeiten/Trends** (z. B. gehäufte Lieferprobleme, ein bestimmtes Produkt, ein Zeitpunkt).\n" +
    "3. **2–3 konkrete Handlungsempfehlungen**.\n" +
    "Kurz und konkret, keine Einleitung.\n\n" +
    `NACHRICHTEN:\n${corpus}`;

  return complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 1500 });
}

/** Klassifiziert noch nicht klassifizierte Tickets des Zeitraums (Kategorie + Sentiment + Produkt). */
export async function classifyTickets(
  shopId: string,
  days: number,
): Promise<{ classified: number; remaining: number }> {
  await requireBrandCap(shopId, "reports");
  return classifyShopTickets(shopId, days);
}

/** Wochenbericht für einen Shop sofort versenden (Test/Manuell). */
export async function sendWeeklyReportNow(shopId: string, days: number): Promise<{ to: string[] }> {
  await requireBrandCap(shopId, "reports");
  return sendWeeklyReport(shopId, days);
}
