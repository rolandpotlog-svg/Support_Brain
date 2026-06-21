"use server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireReports, requireUser } from "@/server/access";
import { complete } from "@/server/ai";
import { classifyShopTickets } from "@/server/ai/classify";
import { getSettings } from "@/server/returns";
import { sendWeeklyReport } from "@/server/reports-send";
import { loadShopifyCreds } from "@/server/shopify-config";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import { buildSystemPrompt, emptyProfile } from "@/lib/profile/types";
import { euro } from "@/lib/format";

function money(m: { amount: string; currencyCode: string } | null): string {
  return m ? euro(m.amount, m.currencyCode) : "—";
}

function formatResolution(r: Resolution): string {
  if (r.mode === "order") {
    const o = r.order;
    const tracking = o.tracking.map((t) => `${t.company ?? "Carrier"} ${t.number ?? ""}`.trim()).join(", ");
    const items = o.lineItems.map((li) => `${li.quantity}× ${li.title}`).join(", ");
    return [
      `Bestellung ${o.name} vom ${new Date(o.createdAt).toLocaleDateString("de-DE")}`,
      `Zahlung: ${o.financialStatus ?? "?"} · Versand: ${o.fulfillmentStatus ?? "?"} · Summe: ${money(o.total)}`,
      tracking ? `Tracking: ${tracking}` : "Tracking: keins hinterlegt",
      items ? `Artikel: ${items}` : "",
    ].filter(Boolean).join("\n");
  }
  if (r.mode === "customer") {
    const c = r.customer;
    const o = r.orders[0];
    const last = o
      ? `Letzte Bestellung ${o.name}: ${o.financialStatus ?? "?"}/${o.fulfillmentStatus ?? "?"}, ${money(o.total)}`
      : "Noch keine Bestellungen.";
    return `Kunde ${c.displayName} (${c.numberOfOrders} Bestellungen). ${last}`;
  }
  if (r.mode === "candidates") return "Mehrere mögliche Kunden über den Namen — nicht eindeutig zugeordnet.";
  if (r.mode === "none") return "Kein Shopify-Treffer für diesen Kunden/diese Bestellung.";
  return "Shopify nicht verfügbar.";
}

/** KI-Antwortentwurf: Shop-Profil + Ticket-Verlauf + Shopify-Bestelldaten -> Entwurf. Draft-First. */
export async function draftReply(threadId: string): Promise<string> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");
  await assertShopAccess(user, thread.shopId);

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, thread.shopId) });
  const profile = await db.query.shopProfile.findFirst({
    where: eq(schema.shopProfile.shopId, thread.shopId),
  });
  const systemBase = profile?.systemPrompt || buildSystemPrompt(emptyProfile(), shop?.name ?? "unser Shop");

  // Rückgabe-Brücke: ist das Portal aktiv, bekommt die KI den Link + die Anweisung,
  // ihn NUR bei Rückgabe-/Umtausch-/Erstattungswunsch einzubauen.
  let returnsHint = "";
  const rset = await getSettings(thread.shopId);
  if (rset?.enabled && shop?.slug) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const portalUrl = `${appUrl}/r/${shop.slug}`;
    returnsHint =
      "\n\n--- RÜCKGABE/RETOURE ---\n" +
      "Falls der Kunde eine Rückgabe, Retoure, einen Umtausch oder eine Erstattung möchte: weise freundlich auf unser " +
      "Self-Service-Rückgabeportal hin und füge GENAU diese URL ein (keine andere erfinden, nicht kürzen): " +
      portalUrl +
      "\nFormuliere es als Einladung (dort Bestellnummer + E-Mail eingeben, dann ist alles in wenigen Schritten erledigt). " +
      "Geht es NICHT um eine Rückgabe/Umtausch/Erstattung, erwähne das Portal nicht.";
  }

  const system =
    systemBase +
    "\n\n--- AUSGABE-REGELN ---\n" +
    "Verfasse NUR die nächste E-Mail-Antwort an den Kunden, auf Deutsch. " +
    "Keine Betreffzeile, keine Vorrede, keine Erklärungen, keine Meta-Kommentare, keine Platzhalter. " +
    "Wenn die Richtlinien eine Eskalation verlangen oder zentrale Infos fehlen, schreibe stattdessen kurz und freundlich, " +
    "dass du dich kümmerst und ggf. Rücksprache hältst — erfinde nichts (keine Tracking-Nummern, Fristen, Beträge)." +
    returnsHint;

  const msgs = await db
    .select({
      direction: schema.messages.direction,
      internal: schema.messages.internal,
      bodyText: schema.messages.bodyText,
    })
    .from(schema.messages)
    .where(eq(schema.messages.threadId, threadId))
    .orderBy(schema.messages.createdAt);
  const history =
    msgs
      .filter((m) => !m.internal && m.bodyText)
      .map((m) => `${m.direction === "inbound" ? thread.customerName || "Kunde" : "Support"}: ${m.bodyText!.trim()}`)
      .join("\n\n") || "(kein Text)";

  let orderContext = "Shopify ist für diesen Shop nicht verbunden.";
  const creds = await loadShopifyCreds(thread.shopId);
  if (creds) {
    const firstInbound = await db.query.messages.findFirst({
      where: eq(schema.messages.threadId, threadId),
    });
    try {
      const r = await resolveForThread(creds, {
        email: thread.customerEmail,
        subject: thread.subject,
        body: firstInbound?.bodyText ?? null,
        name: thread.customerName,
      });
      orderContext = formatResolution(r);
    } catch {
      orderContext = "Shopify-Abgleich fehlgeschlagen.";
    }
  }

  const userMsg = [
    `KUNDE: ${thread.customerName || ""} <${thread.customerEmail}>`,
    `BETREFF: ${thread.subject ?? "(kein Betreff)"}`,
    "",
    "TICKET-VERLAUF:",
    history,
    "",
    "SHOPIFY-KONTEXT:",
    orderContext,
    "",
    "Verfasse jetzt die nächste Antwort an den Kunden.",
  ].join("\n");

  const draft = await complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 2000 });
  // Entwurf merken, um beim Senden zu erkennen, ob er 1:1 übernommen oder bearbeitet wurde.
  await db.update(schema.threads).set({ lastAiDraft: draft }).where(eq(schema.threads.id, threadId));
  return draft;
}

/** KI-Analyse der häufigsten Beschwerden im Zeitraum (für die wöchentliche Auswertung). */
export async function analyzeComplaints(shopId: string, days: number): Promise<string> {
  await requireReports();
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
  await requireReports();
  return classifyShopTickets(shopId, days);
}

/** Wochenbericht für einen Shop sofort versenden (Test/Manuell). */
export async function sendWeeklyReportNow(shopId: string, days: number): Promise<{ to: string[] }> {
  await requireReports();
  return sendWeeklyReport(shopId, days);
}
