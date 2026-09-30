// Bestell-Abgleich je Ticket: Bestellung finden, mehrfach gegenprüfen und das Ergebnis am Ticket speichern.
// Nur eine „sichere“ Zuordnung darf in KI-Antworten mit Details (Artikel, Adresse, Tracking) verwendet werden.
// Die gespeicherten Artikel sind die Produkt-Wahrheit für die Produktanalyse (echte Shopify-Titel statt KI-Raten).
import { and, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { loadShopifyCreds } from "@/server/shopify-config";
import { namesMatch, resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import type { ShopifyCustomer, ShopifyOrder } from "@/lib/shopify/client";
import { bestBodyText } from "@/lib/mailbox/html-text";

export type CheckStatus = "ok" | "info" | "warn" | "fail";
export type OrderCheck = { label: string; status: CheckStatus; detail?: string };
export type Confidence = "sicher" | "unsicher" | "keine";
export type OrderItem = { title: string; variantTitle: string | null; quantity: number; properties: { key: string; value: string }[] };

export type OrderLink = {
  confidence: Confidence;
  order: ShopifyOrder | null;
  customer: ShopifyCustomer | null;
  resolution: Resolution;
  checks: OrderCheck[];
};

const days = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

const DELIVERY_LABEL: Record<string, string> = {
  DELIVERED: "zugestellt",
  IN_TRANSIT: "unterwegs",
  OUT_FOR_DELIVERY: "in Zustellung",
  ATTEMPTED_DELIVERY: "Zustellversuch",
  READY_FOR_PICKUP: "abholbereit",
  FAILURE: "Zustellproblem",
  LABEL_PRINTED: "Label erstellt",
  CONFIRMED: "bestätigt",
  FULFILLED: "versendet",
};

/** Bestellung zum Ticket finden + prüfen + speichern. Wirft nie (Fehler -> „keine“ mit Hinweis). */
export async function linkThreadOrder(threadId: string): Promise<OrderLink | null> {
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) return null;
  const creds = await loadShopifyCreds(thread.shopId);
  if (!creds) return null;

  const firstInbound = await db.query.messages.findFirst({
    where: and(eq(schema.messages.threadId, threadId), eq(schema.messages.direction, "inbound")),
    orderBy: schema.messages.createdAt,
  });
  const resolution = await resolveForThread(creds, {
    email: thread.customerEmail,
    subject: thread.subject,
    body: firstInbound ? bestBodyText(firstInbound.bodyText, firstInbound.bodyHtml) : null,
    name: thread.customerName,
    manualOrderName: thread.manualOrderName,
  });

  const checks: OrderCheck[] = [];
  let order: ShopifyOrder | null = null;
  let customer: ShopifyCustomer | null = null;

  if (resolution.mode === "order") {
    order = resolution.order;
    customer = resolution.customer;
    checks.push(
      resolution.verified === "manual"
        ? { label: "Bestellung manuell gesetzt", status: "ok", detail: order.name }
        : { label: "Bestellnummer in der Mail gefunden", status: "ok", detail: order.name },
    );
    if (resolution.verified === "name")
      checks.push({ label: "Kunde schreibt von anderer E-Mail — Name + Bestellnummer passen", status: "warn", detail: order.email ?? "" });
  } else if (resolution.mode === "mismatch") {
    // Fremde Bestellnummer: NICHT zuordnen (keine Artikel speichern, keine Details an die KI).
    checks.push({
      label: `Bestellnummer #${resolution.orderNumber} gehört zu einem anderen Kunden`,
      status: "fail",
      detail: `${resolution.order.shippingAddress?.name ?? resolution.customer?.displayName ?? "?"} — E-Mail und Name passen nicht`,
    });
  } else if (resolution.mode === "customer") {
    if (resolution.note) checks.push({ label: resolution.note, status: "warn" });
    customer = resolution.customer;
    order = resolution.orders[0] ?? null;
    if (resolution.total > 1)
      checks.push({ label: `Kunde hat ${resolution.total} Bestellungen`, status: "warn", detail: "neueste gewählt — ggf. manuell setzen" });
  } else if (resolution.mode === "orders") {
    if (resolution.note) checks.push({ label: resolution.note, status: "warn" });
    order = resolution.orders[0] ?? null;
    if (resolution.orders.length > 1)
      checks.push({ label: `${resolution.orders.length} Gast-Bestellungen zu dieser E-Mail`, status: "warn", detail: "neueste gewählt — ggf. manuell setzen" });
  } else if (resolution.mode === "candidates") {
    checks.push({ label: "Mehrere Kunden mit diesem Namen", status: "warn", detail: "keine sichere Zuordnung" });
  } else if (resolution.mode === "error") {
    checks.push({ label: "Shopify-Abgleich fehlgeschlagen", status: "fail", detail: resolution.message });
  } else {
    checks.push({ label: "Keine Bestellung gefunden", status: "info" });
  }

  let confidence: Confidence = "keine";
  if (order) {
    const me = thread.customerEmail.trim().toLowerCase();
    const emailOk = [order.email, customer?.email].some((e) => e && e.trim().toLowerCase() === me);
    checks.push(
      emailOk
        ? { label: "E-Mail stimmt mit der Bestellung überein", status: "ok" }
        : { label: "E-Mail weicht von der Bestellung ab", status: "fail", detail: order.email ?? "—" },
    );
    const nm = namesMatch(thread.customerName, order.shippingAddress?.name ?? customer?.displayName);
    if (nm !== null)
      checks.push(
        nm
          ? { label: "Name passt zur Lieferadresse", status: "ok" }
          : { label: "Name weicht von der Lieferadresse ab", status: "warn", detail: order.shippingAddress?.name ?? "" },
      );
    const nameVerified = resolution.mode === "order" && resolution.verified === "name";
    confidence = emailOk || nameVerified || thread.manualOrderName ? "sicher" : "unsicher";

    // Versand
    const age = days(order.createdAt);
    checks.push({ label: `Bestellt vor ${age} Tag(en)`, status: "info", detail: new Date(order.createdAt).toLocaleDateString("de-DE") });
    const d = order.delivery;
    if (d?.status) {
      const when = d.deliveredAt ? ` am ${new Date(d.deliveredAt).toLocaleDateString("de-DE")}` : d.estimatedAt ? `, voraussichtlich ${new Date(d.estimatedAt).toLocaleDateString("de-DE")}` : "";
      checks.push({ label: `Sendung: ${DELIVERY_LABEL[d.status] ?? d.status}${when}`, status: d.status === "FAILURE" ? "warn" : "info" });
    } else if (!order.tracking.length) {
      checks.push({ label: "Noch keine Sendungsnummer", status: "info" });
    }

    // Weitere Abgleiche im eigenen Shop
    const [ret] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.returnCases)
      .where(and(eq(schema.returnCases.shopId, thread.shopId), eq(schema.returnCases.orderName, order.name)));
    if (ret?.n) checks.push({ label: `Retoure zu dieser Bestellung existiert (${ret.n}×)`, status: "warn" });
    const [cl] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.supplierClaim)
      .where(and(eq(schema.supplierClaim.shopId, thread.shopId), eq(schema.supplierClaim.orderName, order.name)));
    if (cl?.n) checks.push({ label: `Reklamation zu dieser Bestellung existiert (${cl.n}×)`, status: "warn" });
    const [same] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.threads)
      .where(and(eq(schema.threads.shopId, thread.shopId), eq(schema.threads.orderName, order.name), ne(schema.threads.id, threadId)));
    if (same?.n) checks.push({ label: `Bestellung schon in ${same.n} anderem Ticket`, status: "info" });
  }
  if (resolution.mode === "mismatch") confidence = "unsicher"; // fremde Nummer -> KI nennt keine Details
  const [prev] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, thread.shopId),
        sql`lower(${schema.threads.customerEmail}) = lower(${thread.customerEmail})`,
        ne(schema.threads.id, threadId),
      ),
    );
  if (prev?.n) checks.push({ label: `Kunde hat schon ${prev.n} frühere(s) Ticket(s)`, status: "info" });

  const items: OrderItem[] = (order?.lineItems ?? []).map((li) => ({
    title: li.title,
    variantTitle: li.variantTitle,
    quantity: li.quantity,
    properties: li.properties,
  }));
  await db
    .update(schema.threads)
    .set({
      orderName: order?.name ?? null,
      orderConfidence: confidence,
      orderChecks: checks,
      orderItems: items,
      orderMatchedAt: new Date(),
    })
    .where(eq(schema.threads.id, threadId));

  return { confidence, order, customer, resolution, checks };
}

/** Knappe Zusammenfassung der Prüfungen für den KI-Prompt (Warnungen + Infos). */
export function checksForPrompt(checks: OrderCheck[]): string {
  return checks
    .filter((c) => c.status !== "ok")
    .map((c) => `- ${c.label}${c.detail ? ` (${c.detail})` : ""}`)
    .join("\n");
}
