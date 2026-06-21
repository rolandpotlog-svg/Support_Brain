// Automatischer Abgleich Mail -> Shopify, in fester Reihenfolge:
//   0) manuell gemerkte Bestellung (Vorrang)
//   1) Bestellnummer (Betreff/Text)
//   2) Absender-E-Mail -> Kundenkonto, sonst Gast-Bestellungen über die E-Mail
//   3) Name (Fallback): 1 Treffer -> direkt; mehrere -> per E-Mail eingrenzen, sonst Auswahl
import {
  findCustomerByEmail,
  findCustomersByName,
  findOrdersByEmail,
  getCustomerOrders,
  getOrderByName,
  type ShopifyCreds,
  type ShopifyCustomer,
  type ShopifyOrder,
} from "./client";

export type Resolution =
  | { mode: "unconfigured" }
  | { mode: "error"; message: string }
  | { mode: "order"; order: ShopifyOrder; customer: ShopifyCustomer | null; matchedBy: "number" }
  | {
      mode: "customer";
      customer: ShopifyCustomer;
      orders: ShopifyOrder[];
      cursor: string | null;
      hasNext: boolean;
      total: number;
      page: number;
      matchedBy: "email";
    }
  | { mode: "orders"; orders: ShopifyOrder[]; matchedBy: "email" }
  | { mode: "candidates"; candidates: ShopifyCustomer[] }
  | { mode: "none" };

/** Nur den neuesten Mail-Teil behalten (zitierte Verläufe abschneiden). */
function latestPart(body: string | null): string {
  if (!body) return "";
  const markers = [
    /\n\s*>/, // zitierte Zeilen
    /\nAm .+ schrieb/i,
    /\nOn .+ wrote:/i,
    /\nVon:\s/i,
    /\nFrom:\s/i,
    /\n-{2,}\s*Ursprüngliche Nachricht/i,
    /\n_{5,}/,
  ];
  let cut = body.length;
  for (const m of markers) {
    const idx = body.search(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return body.slice(0, cut);
}

/** Bestellnummer aus Betreff/Text ziehen (z. B. #1264, Bestellung 1264, Nr. 1264, Order 1264). */
export function extractOrderNumber(subject: string | null, body: string | null): string | null {
  const text = `${subject ?? ""}\n${latestPart(body)}`;
  const hash = text.match(/#\s?(\d{3,})/);
  if (hash) return hash[1];
  const labeled = text.match(/(?:bestell(?:ung|nummer|-?nr)?|order|nr)\.?\s*#?\s*(\d{4,})/i);
  if (labeled) return labeled[1];
  return null;
}

async function asCustomer(creds: ShopifyCreds, customer: ShopifyCustomer): Promise<Resolution> {
  const o = await getCustomerOrders(creds, customer.id);
  return {
    mode: "customer",
    customer,
    orders: o.orders,
    cursor: o.cursor,
    hasNext: o.hasNext,
    total: o.total,
    page: 1,
    matchedBy: "email",
  };
}

export async function resolveForThread(
  creds: ShopifyCreds,
  input: {
    email: string;
    subject: string | null;
    body: string | null;
    name: string | null;
    manualOrderName?: string | null;
  },
): Promise<Resolution> {
  try {
    // 0) Manuell gemerkte Bestellung hat Vorrang.
    if (input.manualOrderName) {
      const hit = await getOrderByName(creds, input.manualOrderName);
      if (hit) return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number" };
    }

    // 1) Bestellnummer aus Betreff/Text
    const num = extractOrderNumber(input.subject, input.body);
    if (num) {
      const hit = await getOrderByName(creds, num);
      if (hit) return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number" };
    }

    // 2) E-Mail -> Kundenkonto, sonst Gast-Bestellungen
    const email = (input.email ?? "").trim();
    if (email && !email.includes("unknown")) {
      const customer = await findCustomerByEmail(creds, email);
      if (customer) return await asCustomer(creds, customer);
      const guestOrders = await findOrdersByEmail(creds, email);
      if (guestOrders.length) return { mode: "orders", orders: guestOrders, matchedBy: "email" };
    }

    // 3) Name (Fallback) mit Auflösung
    if (input.name) {
      const candidates = await findCustomersByName(creds, input.name);
      if (candidates.length === 1) return await asCustomer(creds, candidates[0]);
      if (candidates.length > 1) {
        const byEmail = candidates.find(
          (c) => c.email && email && c.email.toLowerCase() === email.toLowerCase(),
        );
        if (byEmail) return await asCustomer(creds, byEmail);
        return { mode: "candidates", candidates };
      }
    }

    return { mode: "none" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
