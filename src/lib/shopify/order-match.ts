// Automatischer Abgleich Mail -> Shopify, in fester Reihenfolge:
//   1) Bestellnummer (Betreff/Text)  2) Absender-E-Mail  3) Name (Fallback, mehrdeutig!)
import {
  findCustomerByEmail,
  findCustomersByName,
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
  | { mode: "candidates"; candidates: ShopifyCustomer[] }
  | { mode: "none" };

/** Bestellnummer aus Betreff/Text ziehen (z. B. #335675775). */
export function extractOrderNumber(subject: string | null, body: string | null): string | null {
  const text = `${subject ?? ""}\n${body ?? ""}`;
  const hash = text.match(/#\s?(\d{3,})/);
  if (hash) return hash[1];
  const labeled = text.match(/(?:bestell(?:ung|nummer|-?nr)|order)\D{0,12}(\d{4,})/i);
  if (labeled) return labeled[1];
  return null;
}

export async function resolveForThread(
  creds: ShopifyCreds,
  input: {
    email: string;
    subject: string | null;
    body: string | null;
    name: string | null;
  },
): Promise<Resolution> {
  try {
    // 1) Bestellnummer
    const num = extractOrderNumber(input.subject, input.body);
    if (num) {
      const hit = await getOrderByName(creds, num);
      if (hit) return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number" };
    }

    // 2) E-Mail
    if (input.email && !input.email.includes("unknown")) {
      const customer = await findCustomerByEmail(creds, input.email);
      if (customer) {
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
    }

    // 3) Name (Fallback) — niemals stillschweigend zuordnen: immer Auswahl zeigen.
    if (input.name) {
      const candidates = await findCustomersByName(creds, input.name);
      if (candidates.length > 0) return { mode: "candidates", candidates };
    }

    return { mode: "none" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
