"use server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";
import { resolveForThread, type Resolution } from "@/lib/shopify/order-match";
import {
  findCustomerByEmail,
  findCustomersByName,
  getCustomerOrders,
  getOrderByName,
  isConfigured,
  type ShopifyCustomer,
  type ShopifyOrder,
} from "@/lib/shopify/client";

/** Auflösung für ein Ticket: Bestellnummer -> E-Mail -> Name. */
export async function resolveThreadShopify(threadId: string): Promise<Resolution> {
  const user = await requireUser();
  const thread = await db.query.threads.findFirst({
    where: eq(schema.threads.id, threadId),
  });
  if (!thread) return { mode: "error", message: "Thread nicht gefunden" };
  await assertShopAccess(user, thread.shopId);

  const firstInbound = await db.query.messages.findFirst({
    where: eq(schema.messages.threadId, threadId),
  });

  return resolveForThread({
    email: thread.customerEmail,
    subject: thread.subject,
    body: firstInbound?.bodyText ?? null,
    name: thread.customerName,
  });
}

/** Weitere Bestellungen eines Kunden nachladen (Pagination). */
export async function loadCustomerOrders(
  customerId: string,
  after: string | null,
): Promise<{ orders: ShopifyOrder[]; cursor: string | null; hasNext: boolean; total: number }> {
  await requireUser();
  return getCustomerOrders(customerId, after);
}

/** Manuelle Suche, wenn nichts automatisch gefunden wurde. */
export async function manualSearch(
  type: "order" | "email" | "name",
  query: string,
): Promise<Resolution> {
  await requireUser();
  if (!isConfigured()) return { mode: "unconfigured" };
  const q = query.trim();
  if (!q) return { mode: "none" };
  try {
    if (type === "order") {
      const hit = await getOrderByName(q);
      return hit
        ? { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number" }
        : { mode: "none" };
    }
    if (type === "email") {
      const customer = await findCustomerByEmail(q);
      if (!customer) return { mode: "none" };
      const o = await getCustomerOrders(customer.id);
      return { mode: "customer", customer, orders: o.orders, cursor: o.cursor, hasNext: o.hasNext, total: o.total, page: 1, matchedBy: "email" };
    }
    const candidates = await findCustomersByName(q);
    return candidates.length ? { mode: "candidates", candidates } : { mode: "none" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Einen Namens-Kandidaten manuell auswählen -> dessen Bestellungen laden. */
export async function pickCandidate(
  customer: ShopifyCustomer,
): Promise<Resolution> {
  await requireUser();
  try {
    const o = await getCustomerOrders(customer.id);
    return { mode: "customer", customer, orders: o.orders, cursor: o.cursor, hasNext: o.hasNext, total: o.total, page: 1, matchedBy: "email" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
