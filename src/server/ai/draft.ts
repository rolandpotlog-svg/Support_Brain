// KI-Antwortentwurf erzeugen (ohne Login-Prüfung) — genutzt von der Server-Action (Knopf „KI-Entwurf")
// und vom Worker (Auto-Entwurf zu jeder neuen Kundenmail). Die Zugriffsprüfung macht der Aufrufer.
import { eq, and, desc, ne, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { complete } from "@/server/ai";
import { getSettings } from "@/server/returns";
import { loadShopifyCreds } from "@/server/shopify-config";
import type { Resolution } from "@/lib/shopify/order-match";
import { checksForPrompt, linkThreadOrder } from "@/server/order-link";
import { intentLabel } from "@/lib/support/intents";
import { activeLessonsForPrompt } from "@/server/ai/learn";
import { trackingUrl } from "@/lib/shopify/client";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { buildSystemPrompt, emptyProfile } from "@/lib/profile/types";
import { draftSystemPrompt, parseDraft, type DraftDecision } from "@/server/ai/draft-prompt";
import { stripQuoted } from "@/server/ai/shadow-compare";
import { euro } from "@/lib/format";
import { checkDraft, type DraftCheck } from "@/server/ai/check";

// Denk-Stufe für Entwürfe (per Qualitätstest festgelegt; über ENV umstellbar ohne Code-Änderung).
const DRAFT_EFFORT = (process.env.DRAFT_EFFORT as "low" | "medium" | "high" | undefined) ?? "medium";

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
  // Artikel inkl. Variante + Gravur/Personalisierung (für „Gravur falsch“, „falsche Farbe“ etc.).
  const items = o.lineItems
    .map((li) => {
      const v = li.variantTitle ? ` (${li.variantTitle})` : "";
      const p = li.properties.length ? ` [${li.properties.map((x) => `${x.key}: ${x.value}`).join("; ")}]` : "";
      return `${li.quantity}× ${li.title}${v}${p}`;
    })
    .join(", ");
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
export type DraftPrep = { system: string; userMsg: string; signature: string; shopId: string };

/** Entwurf erzeugen (Worker + Server-Action): vorbereiten -> KI -> speichern -> prüfen. */
export async function generateDraft(threadId: string, intent?: string): Promise<DraftDecision & { check?: DraftCheck }> {
  const prep = await prepareDraft(threadId, intent);
  const raw = await complete({ system: prep.system, messages: [{ role: "user", content: prep.userMsg }], maxTokens: 8000, effort: DRAFT_EFFORT, kind: "entwurf", shopId: prep.shopId });
  const d = await finishDraft(threadId, prep, raw);
  const check = await runCheck(threadId, prep, d);
  return { ...d, check };
}

/** Prüfung zum Entwurf (Fehler in der Prüfung blockieren nie den Entwurf selbst). */
export async function runCheck(threadId: string, prep: DraftPrep, d: DraftDecision & { body: string }): Promise<DraftCheck | undefined> {
  try {
    return await checkDraft({ threadId, shopId: prep.shopId, body: d.body, decision: d.decision, system: prep.system, userMsg: prep.userMsg });
  } catch (e) {
    console.error("[draft] Prüfung fehlgeschlagen:", e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** Alles, was die KI für den Entwurf braucht (Profil, Verlauf, Shopify, Vorgeschichte, Lernbuch). */
export async function prepareDraft(threadId: string, intent?: string): Promise<DraftPrep> {
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

  // Gelernte, vom Team bestätigte Regeln (Lernbuch) — Vorrang vor dem allgemeinen Profil.
  const lessons = await activeLessonsForPrompt(thread.shopId, thread.aiIntent);
  const system = draftSystemPrompt(systemBase, signature, pdata.closing, returnsHint) + lessons;

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
      // Zitierten Altverlauf („Am … schrieb …“) entfernen — sonst doppelt im Prompt und verwirrend.
      .map((m) => ({ ...m, text: stripQuoted(bestBodyText(m.bodyText, m.bodyHtml) ?? "") || bestBodyText(m.bodyText, m.bodyHtml) }))
      .filter((m) => !m.internal && m.text)
      .map((m) => `${m.direction === "inbound" ? thread.customerName || "Kunde" : "Support"}: ${m.text!.trim()}`)
      .join("\n\n") || "(kein Text)";

  let orderContext = "Shopify ist für diesen Shop nicht verbunden.";
  const creds = await loadShopifyCreds(thread.shopId);
  if (creds) {
    try {
      // Bestell-Abgleich mit Mehrfach-Prüfung (wird am Ticket gespeichert — auch für die Produktanalyse).
      const link = await linkThreadOrder(threadId);
      const r = link?.resolution;
      if (!link || !r) {
        orderContext = "Shopify-Abgleich fehlgeschlagen.";
      } else if (link.confidence === "unsicher") {
        // Sicherheit: Bestelldaten nur verwenden, wenn sie nachweislich zu DIESEM Absender gehören.
        orderContext =
          "ACHTUNG: Keine Bestellung, die nachweislich zu diesem Absender gehört (die genannte Bestellnummer gehört zu einem anderen Kunden " +
          "oder passt nicht zu E-Mail/Name). Nenne KEINE Bestelldetails (keine Artikel, Adresse, Trackingnummer, Beträge) und bestätige nichts. " +
          "Bitte den Kunden freundlich um die richtige Bestellnummer oder die E-Mail-Adresse, mit der bestellt wurde " +
          "(evtl. Tippfehler oder Verwechslung mit einem anderen Shop). Das darfst du selbst beantworten (AUTO).";
      } else {
        orderContext = link.order ? orderLines(link.order) : formatResolution(r);
      }
      const extra = link ? checksForPrompt(link.checks) : "";
      if (extra && link?.confidence !== "unsicher") orderContext += `\n\nABGLEICH-HINWEISE:\n${extra}`;
    } catch {
      orderContext = "Shopify-Abgleich fehlgeschlagen.";
    }
  }

  // Frisch laden: Anliegen-Erkennung/Abgleich können gerade erst gelaufen sein.
  const freshThread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });

  // Kundenhistorie: frühere Tickets desselben Kunden (gleicher Shop) — worum ging es, was haben wir geantwortet?
  // Damit geht die KI auf Vorgeschichte ein und sagt nichts doppelt zu (z. B. zweiter SORRY20-Code).
  const pastThreads = await db
    .select({ id: schema.threads.id, subject: schema.threads.subject, summary: schema.threads.aiSummary, createdAt: schema.threads.createdAt })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, thread.shopId),
        ne(schema.threads.id, threadId),
        isNull(schema.threads.deletedAt),
        // Gleicher Kunde = gleiche E-Mail ODER gleiche (sicher zugeordnete) Bestellnummer — auch wenn er
        // später von einer anderen Adresse schreibt.
        freshThread?.orderName
          ? sql`(lower(${schema.threads.customerEmail}) = lower(${thread.customerEmail}) or ${schema.threads.orderName} = ${freshThread.orderName})`
          : sql`lower(${schema.threads.customerEmail}) = lower(${thread.customerEmail})`,
      ),
    )
    .orderBy(desc(schema.threads.createdAt))
    .limit(5);
  const history2: string[] = [];
  for (const p of pastThreads) {
    const lastOut = await db.query.messages.findFirst({
      where: and(eq(schema.messages.threadId, p.id), eq(schema.messages.direction, "outbound"), eq(schema.messages.internal, false)),
      orderBy: desc(schema.messages.createdAt),
    });
    const ans = lastOut?.bodyText ? (stripQuoted(lastOut.bodyText) || lastOut.bodyText).replace(/\s+/g, " ").slice(0, 500) : "(keine Antwort gesendet)";
    history2.push(
      `- ${p.createdAt.toLocaleDateString("de-DE")} · ${p.subject ?? "(ohne Betreff)"}${p.summary ? ` · Anliegen: ${p.summary}` : ""}\n  Unsere letzte Antwort: ${ans}`,
    );
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
    history2.length
      ? "FRÜHERE TICKETS DIESES KUNDEN (Vorgeschichte — darauf eingehen, wenn es passt; Zusagen/Codes nicht doppelt geben):\n" + history2.join("\n")
      : "FRÜHERE TICKETS DIESES KUNDEN: keine",
    "",
    // Anliegen-Erkennung (aktuelles Anliegen der letzten Kundennachricht) — bestimmt den Ablauf.
    freshThread?.aiIntent
      ? `ERKANNTES ANLIEGEN: ${intentLabel(freshThread.aiIntent)}` +
        (freshThread.aiIssue ? ` · Problem: ${freshThread.aiIssue}` : "") +
        (freshThread.aiItem ? ` · betroffener Artikel: ${freshThread.aiItem}` : "") +
        (freshThread.aiLanguage && freshThread.aiLanguage !== "de" ? ` · Sprache des Kunden: ${freshThread.aiLanguage}` : "") +
        (freshThread.aiSummary ? `\nKunde will jetzt: ${freshThread.aiSummary}` : "")
      : "",
    "",
    // Gewählte Schnellantwort: verbindliche Vorgabe, vom Mitarbeiter freigegeben —
    // auch wenn sie über die Standard-Rabattbefugnis hinausgeht.
    wish
      ? `GEWÜNSCHTE AKTION (vom Support-Mitarbeiter gewählt und freigegeben — setze GENAU das um, freundlich und markengerecht, mit Bezug auf die echte Bestellung):\n${wish}\n`
      : "",
    "Verfasse jetzt die nächste Antwort an den Kunden.",
  ].join("\n");

  return { system, userMsg, signature, shopId: thread.shopId };
}

/** KI-Ausgabe zerlegen, Signatur anhängen, am Ticket speichern. */
export async function finishDraft(threadId: string, prep: DraftPrep, raw: string): Promise<DraftDecision & { body: string }> {
  const { signature } = prep;
  // Denken: Entscheidung (AUTO/MENSCH) + Grund von der eigentlichen Mail trennen.
  const parsed = parseDraft(raw);
  // Leerer Entwurf (z. B. Denk-Budget aufgebraucht) -> NICHT speichern; sonst stünde nur die Signatur im Feld.
  if (parsed.text.trim().length < 20) throw new Error("KI lieferte keinen verwertbaren Entwurf");
  // Feste Signatur deterministisch anhängen (immer exakt gleich; die KI weicht nie ab).
  const full = signature ? `${parsed.text.trimEnd()}\n\n${signature}` : parsed.text;
  // Entwurf merken, um beim Senden zu erkennen, ob er 1:1 übernommen oder bearbeitet wurde.
  // Entscheidung mitspeichern: der Posteingang zeigt sie beim Öffnen an (auch bei Auto-Entwürfen des Workers).
  await db
    .update(schema.threads)
    .set({ lastAiDraft: full, aiDecision: parsed.decision, aiReason: parsed.reason || null, aiDraftAt: new Date(), aiDraftingAt: null, aiCheck: null })
    .where(eq(schema.threads.id, threadId));
  return { ...parsed, text: full, body: parsed.text.trim() };
}

