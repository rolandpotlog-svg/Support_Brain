// Shopify Admin GraphQL API. Credentials kommen PRO SHOP aus der DB (shop_shopify),
// nicht mehr global aus .env — jeder Shop spricht seinen eigenen Store an.
// Die MCP-Verbindung bleibt bewusst für spätere KI-Aktionen reserviert.
const API_VERSION = "2025-01";

/** Zugangsdaten eines einzelnen Shopify-Stores (entschlüsselt, kurzlebig). */
export type ShopifyCreds = { domain: string; token: string };

export type Money = { amount: string; currencyCode: string };
export type ShopifyCustomer = {
  id: string;
  displayName: string;
  email: string | null;
  numberOfOrders: number;
  amountSpent: Money | null;
};
export type Tracking = { number: string | null; url: string | null; company: string | null };
export type LineItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: Money | null;
  imageUrl: string | null;
};
export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  total: Money | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  tracking: Tracking[];
  lineItems: LineItem[];
};

class ShopifyError extends Error {}

async function gql<T>(
  creds: ShopifyCreds,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  if (!creds.domain || !creds.token) throw new ShopifyError("Shopify nicht konfiguriert");
  const res = await fetch(`https://${creds.domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": creds.token,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) throw new ShopifyError(`Shopify HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new ShopifyError(json.errors[0]?.message ?? "GraphQL-Fehler");
  return json.data as T;
}

const ORDER_FIELDS = `
  id
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  fulfillments(first: 10) { trackingInfo { number url company } }
  lineItems(first: 25) {
    nodes {
      title
      variantTitle
      quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      image { url }
    }
  }
`;

const CUSTOMER_FIELDS = `
  id
  displayName
  email
  numberOfOrders
  amountSpent { amount currencyCode }
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapOrder(o: any): ShopifyOrder {
  return {
    id: o.id,
    name: o.name,
    createdAt: o.createdAt,
    total: o.totalPriceSet?.shopMoney ?? null,
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    tracking: (o.fulfillments ?? []).flatMap((f: any) => f.trackingInfo ?? []),
    lineItems: (o.lineItems?.nodes ?? []).map((li: any) => ({
      title: li.title,
      variantTitle: li.variantTitle ?? null,
      quantity: li.quantity,
      price: li.originalUnitPriceSet?.shopMoney ?? null,
      imageUrl: li.image?.url ?? null,
    })),
  };
}

function mapCustomer(c: any): ShopifyCustomer {
  return {
    id: c.id,
    displayName: c.displayName,
    email: c.email ?? null,
    numberOfOrders: Number(c.numberOfOrders ?? 0),
    amountSpent: c.amountSpent ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Bestellung exakt über die Bestellnummer (z. B. "335675775" oder "#335675775"). */
export async function getOrderByName(
  creds: ShopifyCreds,
  raw: string,
): Promise<{ order: ShopifyOrder; customer: ShopifyCustomer | null } | null> {
  const num = raw.replace(/[^0-9]/g, "");
  if (!num) return null;
  const data = await gql<{ orders: { nodes: any[] } }>(
    creds,
    `query($q: String!) { orders(first: 1, query: $q) { nodes { ${ORDER_FIELDS} customer { ${CUSTOMER_FIELDS} } } } }`,
    { q: `name:${num}` },
  );
  const node = data.orders.nodes[0];
  if (!node) return null;
  return { order: mapOrder(node), customer: node.customer ? mapCustomer(node.customer) : null };
}

/** Kunde exakt über die E-Mail-Adresse. */
export async function findCustomerByEmail(
  creds: ShopifyCreds,
  email: string,
): Promise<ShopifyCustomer | null> {
  const data = await gql<{ customers: { nodes: any[] } }>(
    creds,
    `query($q: String!) { customers(first: 1, query: $q) { nodes { ${CUSTOMER_FIELDS} } } }`,
    { q: `email:${email}` },
  );
  const node = data.customers.nodes[0];
  return node ? mapCustomer(node) : null;
}

/** Namensabgleich (Fallback) — kann mehrdeutig sein, daher Liste. */
export async function findCustomersByName(
  creds: ShopifyCreds,
  name: string,
): Promise<ShopifyCustomer[]> {
  const clean = name.trim();
  if (!clean) return [];
  const data = await gql<{ customers: { nodes: any[] } }>(
    creds,
    `query($q: String!) { customers(first: 10, query: $q) { nodes { ${CUSTOMER_FIELDS} } } }`,
    { q: clean },
  );
  return data.customers.nodes.map(mapCustomer);
}

/** Bestellungen eines Kunden, durchblätterbar. */
export async function getCustomerOrders(
  creds: ShopifyCreds,
  customerId: string,
  after: string | null = null,
): Promise<{ orders: ShopifyOrder[]; cursor: string | null; hasNext: boolean; total: number }> {
  const data = await gql<{ customer: any }>(
    creds,
    `query($id: ID!, $after: String) {
       customer(id: $id) {
         numberOfOrders
         orders(first: 1, after: $after, sortKey: CREATED_AT, reverse: true) {
           edges { cursor node { ${ORDER_FIELDS} } }
           pageInfo { hasNextPage }
         }
       }
     }`,
    { id: customerId, after },
  );
  const edges = data.customer?.orders?.edges ?? [];
  return {
    orders: edges.map((e: any) => mapOrder(e.node)),
    cursor: edges.length ? edges[edges.length - 1].cursor : null,
    hasNext: Boolean(data.customer?.orders?.pageInfo?.hasNextPage),
    total: Number(data.customer?.numberOfOrders ?? edges.length),
  };
}

/** Tracking-Link: gelieferte URL bevorzugen, sonst aus Carrier + Nummer bauen. */
export function trackingUrl(t: Tracking): string | null {
  if (t.url) return t.url;
  if (!t.number) return null;
  const c = (t.company ?? "").toLowerCase();
  const n = encodeURIComponent(t.number);
  if (c.includes("dhl")) return `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}`;
  if (c.includes("dpd")) return `https://my.dpd.de/redirect.aspx?action=1&parcelno=${n}`;
  if (c.includes("gls")) return `https://gls-group.com/DE/de/paketverfolgung?match=${n}`;
  if (c.includes("hermes")) return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${n}`;
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes("post")) return `https://www.deutschepost.de/sendung/simpleQuery.html?form.sendungsnummer=${n}`;
  return `https://www.google.com/search?q=${encodeURIComponent((t.company ?? "") + " " + t.number)}`;
}
