// Automatischer Abgleich Mail -> Shopify, mehrstufig GEGENGEPRÜFT:
//   0) manuell gemerkte Bestellung (Vorrang, vom Mitarbeiter bestätigt)
//   1) Bestellnummer aus Betreff/Text — gilt nur, wenn E-Mail ODER Name zur Bestellung passt.
//      Passt beides nicht (z. B. Tippfehler, fremde Nummer) -> NICHT zuordnen, Warnung „mismatch“.
//   2) Absender-E-Mail -> Kundenkonto, sonst Gast-Bestellungen über die E-Mail
//   3) Name allein -> nur Vorschläge (candidates), nie automatische Zuordnung
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
  | {
      mode: "order";
      order: ShopifyOrder;
      customer: ShopifyCustomer | null;
      matchedBy: "number";
      // Wodurch bestätigt: manuell gesetzt, E-Mail passt, oder Name passt (E-Mail weicht ab).
      verified: "manual" | "email" | "name";
    }
  // Bestellnummer gefunden, gehört aber NICHT zum Absender (weder E-Mail noch Name passen).
  | { mode: "mismatch"; order: ShopifyOrder; customer: ShopifyCustomer | null; orderNumber: string }
  | {
      mode: "customer";
      customer: ShopifyCustomer;
      orders: ShopifyOrder[];
      cursor: string | null;
      hasNext: boolean;
      total: number;
      page: number;
      matchedBy: "email";
      note?: string; // z. B. „Bestellnummer #1234 aus der Mail gehört zu einem anderen Kunden“
    }
  | { mode: "orders"; orders: ShopifyOrder[]; matchedBy: "email"; note?: string }
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

const words = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Namen ähnlich? (mind. ein gemeinsames Wort mit ≥ 3 Zeichen, z. B. Nachname). null = nicht prüfbar. */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = words(a).filter((w) => w.length >= 3);
  const y = words(b);
  if (!x.length || !y.length) return null;
  return x.some((w) => y.includes(w));
}

const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

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
    // 0) Manuell gemerkte Bestellung hat Vorrang (vom Mitarbeiter bestätigt).
    if (input.manualOrderName) {
      const hit = await getOrderByName(creds, input.manualOrderName);
      if (hit) return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number", verified: "manual" };
    }

    const email = (input.email ?? "").trim();

    // 1) Bestellnummer aus Betreff/Text — mit Gegenprüfung E-Mail / Name.
    let foreign: { order: ShopifyOrder; customer: ShopifyCustomer | null; num: string } | null = null;
    const num = extractOrderNumber(input.subject, input.body);
    if (num) {
      const hit = await getOrderByName(creds, num);
      if (hit) {
        if (sameEmail(hit.order.email, email) || sameEmail(hit.customer?.email, email)) {
          return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number", verified: "email" };
        }
        const nm =
          namesMatch(input.name, hit.order.shippingAddress?.name) ?? namesMatch(input.name, hit.customer?.displayName);
        if (nm) return { mode: "order", order: hit.order, customer: hit.customer, matchedBy: "number", verified: "name" };
        foreign = { order: hit.order, customer: hit.customer, num }; // gehört jemand anderem -> nicht zuordnen
      }
    }
    const foreignNote = foreign
      ? `Bestellnummer #${foreign.num} aus der Mail gehört zu einem anderen Kunden — nicht zugeordnet.`
      : undefined;

    // 2) E-Mail -> Kundenkonto, sonst Gast-Bestellungen
    if (email && !email.includes("unknown")) {
      const customer = await findCustomerByEmail(creds, email);
      if (customer) {
        const r = await asCustomer(creds, customer);
        return r.mode === "customer" && foreignNote ? { ...r, note: foreignNote } : r;
      }
      const guestOrders = await findOrdersByEmail(creds, email);
      if (guestOrders.length) return { mode: "orders", orders: guestOrders, matchedBy: "email", note: foreignNote };
    }

    // Nummer gehört jemand anderem und über die E-Mail nichts gefunden -> deutlich warnen.
    if (foreign) return { mode: "mismatch", order: foreign.order, customer: foreign.customer, orderNumber: foreign.num };

    // 3) Name allein -> nur Vorschläge, nie automatisch zuordnen
    if (input.name) {
      const candidates = await findCustomersByName(creds, input.name);
      if (candidates.length) return { mode: "candidates", candidates };
    }

    return { mode: "none" };
  } catch (e) {
    return { mode: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
