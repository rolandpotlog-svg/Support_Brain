"use server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireBrandCap, requireUser } from "@/server/access";
import { complete } from "@/server/ai";
import { classifyShopTickets } from "@/server/ai/classify";
import { getSettings } from "@/server/returns";
import { sendWeeklyReport } from "@/server/reports-send";
import { loadShopifyCreds } from "@/server/shopify-config";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import { trackingUrl } from "@/lib/shopify/client";
import { buildSystemPrompt, emptyProfile } from "@/lib/profile/types";
import { euro } from "@/lib/format";

function money(m: { amount: string; currencyCode: string } | null): string {
  return m ? euro(m.amount, m.currencyCode) : "—";
}

function orderLines(o: import("@/lib/shopify/client").ShopifyOrder): string {
  // Tracking inkl. echtem Sendungslink (Carrier-korrekt), damit die KI den richtigen Link einsetzt.
  const tracking = o.tracking
    .map((t) => {
      const label = `${t.company ?? "Carrier"} ${t.number ?? ""}`.trim();
      const url = trackingUrl(t);
      return url ? `${label} — Sendungslink: ${url}` : label;
    })
    .join(" | ");
  const items = o.lineItems.map((li) => `${li.quantity}× ${li.title}`).join(", ");
  return [
    `Bestellung ${o.name} vom ${new Date(o.createdAt).toLocaleDateString("de-DE")}`,
    `Zahlung: ${o.financialStatus ?? "?"} · Versand: ${o.fulfillmentStatus ?? "?"} · Summe: ${money(o.total)}`,
    tracking ? `Tracking: ${tracking}` : "Tracking: keins hinterlegt",
    items ? `Artikel: ${items}` : "",
  ].filter(Boolean).join("\n");
}

function formatResolution(r: Resolution): string {
  if (r.mode === "order") return orderLines(r.order);
  if (r.mode === "orders") {
    if (!r.orders.length) return "Keine Bestellung gefunden.";
    return `Gast-Bestellung(en) über die E-Mail:\n${orderLines(r.orders[0])}`;
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

/**
 * KI-Antwortentwurf: Shop-Profil + Ticket-Verlauf + Shopify-Bestelldaten -> Entwurf. Draft-First.
 * `intent` = optionale, vom Mitarbeiter gewählte Schnellantwort/Absicht
 * (z. B. „Biete 10 % Rabatt auf die aktuelle Bestellung an"), die die Antwort steuert.
 */
export async function draftReply(threadId: string, intent?: string): Promise<string> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");
  await assertShopAccess(user, thread.shopId);

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, thread.shopId) });
  const profile = await db.query.shopProfile.findFirst({
    where: eq(schema.shopProfile.shopId, thread.shopId),
  });
  // Prompt frisch aus den Profildaten bauen (nicht den gespeicherten Prompt nehmen):
  // die Signatur wird unten deterministisch angehängt, darf also NICHT als KI-Anweisung drinstehen.
  const pdata = profile?.data ?? emptyProfile();
  const systemBase = buildSystemPrompt(pdata, shop?.name ?? "unser Shop");
  const signature = (pdata.signature ?? "").trim();

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
    (signature
      ? "Schreibe KEINE Grußformel und KEINE Signatur am Ende (auch kein Viele-Gruesse-Abschluss) — die feste Signatur wird automatisch angehängt. Ende mit dem letzten inhaltlichen Satz. "
      : "") +
    "Wenn die Richtlinien eine Eskalation verlangen oder zentrale Infos fehlen, schreibe stattdessen kurz und freundlich, " +
    "dass du dich kümmerst und ggf. Rücksprache hältst — erfinde nichts (keine Tracking-Nummern, Fristen, Beträge)." +
    "\n\n--- ABSCHLIESSEND ANTWORTEN (SEHR WICHTIG) ---\n" +
    "Ziel: das Anliegen in DIESER einen Mail vollständig erledigen — so, dass danach WEDER wir noch der Kunde nochmal ran müssen. Kein Ping-Pong. " +
    "Denke die wahrscheinliche Folgefrage mit und beantworte sie gleich. " +
    "Handle proaktiv statt zu fragen: wenn ein Zugeständnis feststeht (Rabatt/Erstattung/Ersatz/Behalten), sag es verbindlich zu und erklär konkret, was wir jetzt für den Kunden veranlassen und bis wann — statt zu fragen, ob er es möchte. " +
    "Lege den nächsten Schritt, wo möglich, beim Kunden (Self-Service/klare Handlungsanweisung), nicht bei uns. " +
    "Vermeide offene Enden wie wir melden uns, wir prüfen das und kommen auf Sie zu oder bitte bestätigen Sie kurz — ausser es ist eine echte Eskalation. " +
    "Stelle nur dann eine Rückfrage, wenn die Antwort ohne diese Info wirklich unmöglich ist." +
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
        manualOrderName: thread.manualOrderName,
      });
      orderContext = formatResolution(r);
    } catch {
      orderContext = "Shopify-Abgleich fehlgeschlagen.";
    }
  }

  const wish = (intent ?? "").trim();
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
    // Gewählte Schnellantwort: verbindliche Vorgabe, vom Mitarbeiter freigegeben —
    // auch wenn sie über die Standard-Rabattbefugnis hinausgeht.
    wish
      ? `GEWÜNSCHTE AKTION (vom Support-Mitarbeiter gewählt und freigegeben — setze GENAU das um, freundlich und markengerecht, mit Bezug auf die echte Bestellung):\n${wish}\n`
      : "",
    "Verfasse jetzt die nächste Antwort an den Kunden.",
  ].join("\n");

  const draft = await complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 2000, effort: "low" });
  // Feste Signatur deterministisch anhängen (immer exakt gleich; die KI weicht nie ab).
  const full = signature ? `${draft.trimEnd()}\n\n${signature}` : draft;
  // Entwurf merken, um beim Senden zu erkennen, ob er 1:1 übernommen oder bearbeitet wurde.
  await db.update(schema.threads).set({ lastAiDraft: full }).where(eq(schema.threads.id, threadId));
  return full;
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
    })
    .from(schema.messages)
    .where(eq(schema.messages.threadId, threadId))
    .orderBy(schema.messages.createdAt);

  const transcript = msgs
    .filter((m) => m.bodyText)
    .map((m) => {
      const who = m.internal ? "Notiz" : m.direction === "inbound" ? thread.customerName || "Kunde" : "Support";
      return `${who}: ${m.bodyText!.trim()}`;
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
