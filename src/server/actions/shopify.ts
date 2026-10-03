"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser, requireWrite } from "@/server/access";
import { loadShopifyCreds } from "@/server/shopify-config";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import {
  findCustomerByEmail,
  findCustomersByName,
  findOrdersByEmail,
  getCustomerOrders,
  getOrderByName,
  refundOrderAmount,
  type ShopifyCustomer,
  type ShopifyOrder,
} from "@/lib/shopify/client";

/** Auflösung für ein Ticket: Bestellnummer -> E-Mail -> Name. Store = Shop des Threads. */
export async function resolveThreadShopify(threadId: string): Promise<Resolution> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({
    where: eq(schema.threads.id, threadId),
  });
  if (!thread) return { mode: "error", message: "Thread nicht gefunden" };
  await assertShopAccess(user, thread.shopId);

  const creds = await loadShopifyCreds(thread.shopId);
  if (!creds) return { mode: "unconfigured" };

  const firstInbound = await db.query.messages.findFirst({
    where: eq(schema.messages.threadId, threadId),
  });

  return resolveForThread(creds, {
    email: thread.customerEmail,
    subject: thread.subject,
    body: firstInbound?.bodyText ?? null,
    name: thread.customerName,
    manualOrderName: thread.manualOrderName,
  });
}

/** Bestellung manuell am Ticket merken (oder leeren) — hat ab dann Vorrang, KI nutzt sie. */
export async function setThreadOrder(threadId: string, orderName: string): Promise<Resolution> {
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) return { mode: "error", message: "Thread nicht gefunden" };
  await requireWrite(thread.shopId, "support");
  await db
    .update(schema.threads)
    .set({ manualOrderName: orderName.trim() || null })
    .where(eq(schema.threads.id, threadId));
  return resolveThreadShopify(threadId);
}

/** Weitere Bestellungen eines Kunden nachladen (Pagination), im Store des Shops. */
export async function loadCustomerOrders(
  shopId: string,
  customerId: string,
  after: string | null,
): Promise<{ orders: ShopifyOrder[]; cursor: string | null; hasNext: boolean; total: number }> {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Shop nicht konfiguriert");
  return getCustomerOrders(creds, customerId, after);
}

/** Manuelle Suche, wenn nichts automatisch gefunden wurde. */
export async function manualSearch(
  shopId: string,
  type: "order" | "email" | "name",
  query: string,
): Promise<Resolution> {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const creds = await loadShopifyCreds(shopId);
  if (!creds) return { mode: "unconfigured" };
  const q = query.trim();
  if (!q) return { mode: "none" };
  try {
    if (type === "order") {
      const hit = await getOrderByName(creds, q);
      return hit
        ? { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number", verified: "manual" }
        : { mode: "none" };
    }
    if (type === "email") {
      const customer = await findCustomerByEmail(creds, q);
      if (customer) {
        const o = await getCustomerOrders(creds, customer.id);
        return { mode: "customer", customer, orders: o.orders, cursor: o.cursor, hasNext: o.hasNext, total: o.total, page: 1, matchedBy: "email" };
      }
      const guestOrders = await findOrdersByEmail(creds, q);
      return guestOrders.length ? { mode: "orders", orders: guestOrders, matchedBy: "email" } : { mode: "none" };
    }
    const candidates = await findCustomersByName(creds, q);
    return candidates.length ? { mode: "candidates", candidates } : { mode: "none" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Einen Namens-Kandidaten manuell auswählen -> dessen Bestellungen laden. */
export async function pickCandidate(
  shopId: string,
  customer: ShopifyCustomer,
): Promise<Resolution> {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const creds = await loadShopifyCreds(shopId);
  if (!creds) return { mode: "unconfigured" };
  try {
    const o = await getCustomerOrders(creds, customer.id);
    return { mode: "customer", customer, orders: o.orders, cursor: o.cursor, hasNext: o.hasNext, total: o.total, page: 1, matchedBy: "email" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Erstattung direkt aus dem Panel auslösen (echtes Geld!). Erfordert Support-Schreibrecht.
 * Der Betrag kommt in Cent; die Bestätigung/Sicherheitsabfrage passiert im UI.
 * Bei Erfolg wird eine interne Audit-Notiz am Ticket hinterlegt (wer, wieviel, welche Bestellung).
 */
export async function refundOrder(args: {
  shopId: string;
  threadId: string;
  orderId: string;
  orderName: string;
  amountCents: number;
}): Promise<{ ok: true; refundedAmount: string; currency: string } | { ok: false; error: string }> {
  // Fehler als Rückgabewert: Next.js versteckt geworfene Fehler im Live-Betrieb („An error occurred …“).
  try {
    const r = await refundOrderInner(args);
    return { ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[refund]", args.orderName, msg);
    return { ok: false, error: explainRefundError(msg) };
  }
}

/** Shopify-Fehler in verständliche Sprache übersetzen. */
function explainRefundError(msg: string): string {
  if (/access denied|not approved|scope|write_orders|ACCESS_DENIED/i.test(msg)) {
    return `Shopify erlaubt der App keine Erstattungen (Berechtigung „write_orders“ fehlt). In der Shopify-App die Berechtigung ergänzen und neu installieren. Es wurde NICHTS erstattet. (${msg})`;
  }
  return msg;
}

async function refundOrderInner(args: {
  shopId: string;
  threadId: string;
  orderId: string;
  orderName: string;
  amountCents: number;
}): Promise<{ refundedAmount: string; currency: string }> {
  const { user } = await requireWrite(args.shopId, "support");
  // Trennung: Ticket muss zum selben Shop gehören — VOR der Erstattung prüfen (echtes Geld).
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, args.threadId) });
  if (!thread || thread.shopId !== args.shopId) throw new Error("Ticket gehört nicht zu diesem Shop.");
  if (!Number.isFinite(args.amountCents) || args.amountCents <= 0) {
    throw new Error("Ungültiger Betrag.");
  }
  const creds = await loadShopifyCreds(args.shopId);
  if (!creds) throw new Error("Shopify ist für diesen Shop nicht verbunden.");

  const amount = (args.amountCents / 100).toFixed(2);
  const note = `Support-Kulanz-Erstattung über ${amount} (ausgelöst von ${user.email})`;
  const r = await refundOrderAmount(creds, args.orderId, amount, note);

  // Audit-Spur im Ticket (interne Notiz, Kunde sieht sie nie).
  try {
    await db.insert(schema.messages).values({
      threadId: args.threadId,
      direction: "outbound",
      internal: true,
      fromEmail: user.email,
      bodyText: `💶 Erstattung ausgelöst: ${r.refundedAmount} ${r.currency} für Bestellung ${args.orderName} (via Shopify).`,
      sentBy: user.id,
    });
    revalidatePath("/inbox");
  } catch {
    // Notiz ist nur Bonus — Erstattung ist bereits durch.
  }
  return r;
}
