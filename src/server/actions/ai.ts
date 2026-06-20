"use server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";
import { complete } from "@/server/ai";
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
  const system =
    systemBase +
    "\n\n--- AUSGABE-REGELN ---\n" +
    "Verfasse NUR die nächste E-Mail-Antwort an den Kunden, auf Deutsch. " +
    "Keine Betreffzeile, keine Vorrede, keine Erklärungen, keine Meta-Kommentare, keine Platzhalter. " +
    "Wenn die Richtlinien eine Eskalation verlangen oder zentrale Infos fehlen, schreibe stattdessen kurz und freundlich, " +
    "dass du dich kümmerst und ggf. Rücksprache hältst — erfinde nichts (keine Tracking-Nummern, Fristen, Beträge).";

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

  return complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 2000 });
}
