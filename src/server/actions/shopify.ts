"use server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";
import { loadShopifyCreds } from "@/server/shopify-config";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import {
  findCustomerByEmail,
  findCustomersByName,
  findOrdersByEmail,
  getCustomerOrders,
  getOrderByName,
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
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) return { mode: "error", message: "Thread nicht gefunden" };
  await assertShopAccess(user, thread.shopId);
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
        ? { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number" }
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
