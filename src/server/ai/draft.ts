// KI-Antwortentwurf erzeugen (ohne Login-Prüfung) — genutzt von der Server-Action (Knopf „KI-Entwurf")
// und vom Worker (Auto-Entwurf zu jeder neuen Kundenmail). Die Zugriffsprüfung macht der Aufrufer.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { complete } from "@/server/ai";
import { getSettings } from "@/server/returns";
import { loadShopifyCreds } from "@/server/shopify-config";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import { trackingUrl } from "@/lib/shopify/client";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { buildSystemPrompt, emptyProfile } from "@/lib/profile/types";
import { draftSystemPrompt, parseDraft, type DraftDecision } from "@/server/ai/draft-prompt";
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
  const ageDays = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86_400_000);
  return [
    `Bestellung ${o.name} vom ${new Date(o.createdAt).toLocaleDateString("de-DE")} (vor ${ageDays} Tag(en))`,
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
export async function generateDraft(threadId: string, intent?: string): Promise<DraftDecision> {
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) throw new Error("Thread nicht gefunden");

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

  const system = draftSystemPrompt(systemBase, signature, pdata.closing, returnsHint);

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
  const history =
    msgs
      .map((m) => ({ ...m, text: bestBodyText(m.bodyText, m.bodyHtml) }))
      .filter((m) => !m.internal && m.text)
      .map((m) => `${m.direction === "inbound" ? thread.customerName || "Kunde" : "Support"}: ${m.text!.trim()}`)
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
        body: firstInbound ? bestBodyText(firstInbound.bodyText, firstInbound.bodyHtml) : null,
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

  // Hoher Denk-Aufwand: der Entwurf ist das Kernprodukt — Qualität vor Sparsamkeit.
  const raw = await complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 4000, effort: "high" });
  // Denken: Entscheidung (AUTO/MENSCH) + Grund von der eigentlichen Mail trennen.
  const parsed = parseDraft(raw);
  // Feste Signatur deterministisch anhängen (immer exakt gleich; die KI weicht nie ab).
  const full = signature ? `${parsed.text.trimEnd()}\n\n${signature}` : parsed.text;
  // Entwurf merken, um beim Senden zu erkennen, ob er 1:1 übernommen oder bearbeitet wurde.
  // Entscheidung mitspeichern: der Posteingang zeigt sie beim Öffnen an (auch bei Auto-Entwürfen des Workers).
  await db
    .update(schema.threads)
    .set({ lastAiDraft: full, aiDecision: parsed.decision, aiReason: parsed.reason || null, aiDraftAt: new Date() })
    .where(eq(schema.threads.id, threadId));
  return { ...parsed, text: full };
}

