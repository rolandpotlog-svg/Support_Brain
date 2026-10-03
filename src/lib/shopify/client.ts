// Shopify Admin GraphQL API. Credentials kommen PRO SHOP aus der DB (shop_shopify),
// nicht mehr global aus .env — jeder Shop spricht seinen eigenen Store an.
// Die MCP-Verbindung bleibt bewusst für spätere KI-Aktionen reserviert.
const API_VERSION = "2026-01";

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
export type LineItemProperty = { key: string; value: string };
export type LineItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  price: Money | null;
  imageUrl: string | null;
  // Personalisierung/Gravur: Shopify line-item customAttributes (interne _-Keys gefiltert).
  properties: LineItemProperty[];
};
export type ShopifyAddress = {
  name: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  phone: string | null;
};
export type ShopifyOrder = {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  total: Money | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  discountCodes: string[];
  discountPercentage: number | null; // erste Prozent-Anwendung (z. B. 20 für 20 %)
  totalDiscount: Money | null; // gesamter Rabatt in Geld (nur wenn > 0)
  shippingAddress: ShopifyAddress | null;
  tracking: Tracking[];
  // Sendungsstatus laut Shopify (letzte Sendung): z. B. DELIVERED / IN_TRANSIT + Zeitpunkte.
  delivery: { status: string | null; deliveredAt: string | null; estimatedAt: string | null; inTransitAt: string | null } | null;
  lineItems: LineItem[];
  // Bereits erstattet (Shopify): Summe + einzelne Erstattungen (Zeitpunkt, Betrag, Notiz)
  totalRefunded: Money | null;
  refunds: { at: string; amount: string; currency: string; note: string | null }[];
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
  email
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  discountCodes
  totalDiscountsSet { shopMoney { amount currencyCode } }
  discountApplications(first: 5) {
    nodes {
      value {
        __typename
        ... on PricingPercentageValue { percentage }
        ... on MoneyV2 { amount currencyCode }
      }
    }
  }
  shippingAddress {
    name
    address1
    address2
    zip
    city
    province
    country
    phone
  }
  fulfillments(first: 10) { displayStatus deliveredAt estimatedDeliveryAt inTransitAt trackingInfo { number url company } }
  totalRefundedSet { shopMoney { amount currencyCode } }
  refunds(first: 20) { createdAt note totalRefundedSet { shopMoney { amount currencyCode } } }
  lineItems(first: 25) {
    nodes {
      title
      variantTitle
      quantity
      originalUnitPriceSet { shopMoney { amount currencyCode } }
      image { url }
      customAttributes { key value }
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
    email: o.email ?? null,
    createdAt: o.createdAt,
    total: o.totalPriceSet?.shopMoney ?? null,
    financialStatus: o.displayFinancialStatus ?? null,
    fulfillmentStatus: o.displayFulfillmentStatus ?? null,
    discountCodes: (o.discountCodes ?? []).filter(Boolean),
    discountPercentage: (() => {
      for (const a of o.discountApplications?.nodes ?? []) {
        const v = a?.value;
        if (v?.__typename === "PricingPercentageValue" && v.percentage) return Math.round(v.percentage);
      }
      return null;
    })(),
    totalDiscount:
      o.totalDiscountsSet?.shopMoney && Number(o.totalDiscountsSet.shopMoney.amount) > 0
        ? o.totalDiscountsSet.shopMoney
        : null,
    shippingAddress: o.shippingAddress
      ? {
          name: o.shippingAddress.name ?? null,
          address1: o.shippingAddress.address1 ?? null,
          address2: o.shippingAddress.address2 ?? null,
          zip: o.shippingAddress.zip ?? null,
          city: o.shippingAddress.city ?? null,
          province: o.shippingAddress.province ?? null,
          country: o.shippingAddress.country ?? null,
          phone: o.shippingAddress.phone ?? null,
        }
      : null,
    totalRefunded:
      o.totalRefundedSet?.shopMoney && Number(o.totalRefundedSet.shopMoney.amount) > 0 ? o.totalRefundedSet.shopMoney : null,
    refunds: (o.refunds ?? [])
      .map((r: any) => ({
        at: r.createdAt,
        amount: r.totalRefundedSet?.shopMoney?.amount ?? "0",
        currency: r.totalRefundedSet?.shopMoney?.currencyCode ?? o.totalPriceSet?.shopMoney?.currencyCode ?? "EUR",
        note: r.note ?? null,
      }))
      .filter((r: any) => Number(r.amount) > 0),
    tracking: (o.fulfillments ?? []).flatMap((f: any) => f.trackingInfo ?? []),
    delivery: (() => {
      const f = (o.fulfillments ?? []).at(-1);
      return f
        ? { status: f.displayStatus ?? null, deliveredAt: f.deliveredAt ?? null, estimatedAt: f.estimatedDeliveryAt ?? null, inTransitAt: f.inTransitAt ?? null }
        : null;
    })(),
    lineItems: (o.lineItems?.nodes ?? []).map((li: any) => ({
      title: li.title,
      variantTitle: li.variantTitle ?? null,
      quantity: li.quantity,
      price: li.originalUnitPriceSet?.shopMoney ?? null,
      imageUrl: li.image?.url ?? null,
      // Gravur/Personalisierung: nur befüllte, nicht-interne (_-Präfix) Attribute.
      properties: (li.customAttributes ?? [])
        .filter((a: any) => a?.value && String(a.value).trim() && !String(a.key).startsWith("_"))
        .map((a: any) => ({ key: String(a.key), value: String(a.value) })),
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

/** Leichte Verbindungsprüfung: Shop-Name abrufen. Wirft bei ungültigen Credentials. */
export async function getShopInfo(creds: ShopifyCreds): Promise<{ name: string; domain: string }> {
  const data = await gql<{ shop: { name: string; myshopifyDomain: string } }>(
    creds,
    `query { shop { name myshopifyDomain } }`,
  );
  return { name: data.shop.name, domain: data.shop.myshopifyDomain };
}

export type ShopPolicy = { type: string; title: string; body: string; url: string | null };
export type ShopProfileData = {
  shopName: string;
  currencyCode: string;
  productTypes: string[];
  sampleProducts: { title: string; productType: string | null }[];
  collections: string[];
  policies: ShopPolicy[];
};

/** Datenrückgrat fürs Shop-Profil: Shop-Infos, Produkte, Kollektionen, Richtlinien-Seiten. */
export async function getShopProfileData(creds: ShopifyCreds): Promise<ShopProfileData> {
  const data = await gql<{
    shop: {
      name: string;
      currencyCode: string;
      shopPolicies: { type: string; title: string; body: string | null; url: string | null }[];
    };
    products: { nodes: { title: string; productType: string | null }[] };
    collections: { nodes: { title: string }[] };
  }>(
    creds,
    `query {
       shop {
         name
         currencyCode
         shopPolicies { type title body url }
       }
       products(first: 50, sortKey: BEST_SELLING) { nodes { title productType } }
       collections(first: 50) { nodes { title } }
     }`,
  );

  const sampleProducts = data.products.nodes.map((p) => ({
    title: p.title,
    productType: p.productType || null,
  }));
  const productTypes = [
    ...new Set(sampleProducts.map((p) => p.productType).filter((t): t is string => Boolean(t))),
  ];
  const policies: ShopPolicy[] = (data.shop.shopPolicies ?? []).map((p) => ({
    type: p.type,
    title: p.title,
    body: (p.body ?? "").slice(0, 8000),
    url: p.url ?? null,
  }));

  return {
    shopName: data.shop.name,
    currencyCode: data.shop.currencyCode,
    productTypes,
    sampleProducts: sampleProducts.slice(0, 20),
    collections: data.collections.nodes.map((c) => c.title),
    policies,
  };
}

export type ShopifyDispute = {
  id: string;
  evidenceId: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  type: string;
  reason: string | null;
  reasonCode: string | null;
  evidenceDueBy: string | null;
  evidenceSentOn: string | null;
  finalizedOn: string | null;
  initiatedAt: string | null;
  orderId: string | null;
  orderName: string | null;
  customerEmail: string | null;
  customerName: string | null;
};

/** Shopify-Payments-Disputes des Shops, inkl. verknüpfter Bestellung + Evidence-ID. */
export async function getDisputes(creds: ShopifyCreds, first = 100): Promise<ShopifyDispute[]> {
  const data = await gql<{
    shopifyPaymentsAccount: {
      disputes: {
        nodes: {
          id: string;
          amount: Money | null;
          evidenceDueBy: string | null;
          evidenceSentOn: string | null;
          finalizedOn: string | null;
          initiatedAt: string | null;
          reasonDetails: { reason: string | null; networkReasonCode: string | null } | null;
          status: string;
          type: string;
          disputeEvidence: { id: string } | null;
          order: { id: string; name: string; email: string | null; customer: { displayName: string } | null } | null;
        }[];
      };
    } | null;
  }>(
    creds,
    `query($first: Int!) {
       shopifyPaymentsAccount {
         disputes(first: $first) {
           nodes {
             id
             amount { amount currencyCode }
             evidenceDueBy evidenceSentOn finalizedOn initiatedAt
             reasonDetails { reason networkReasonCode }
             status type
             disputeEvidence { id }
             order { id name email customer { displayName } }
           }
         }
       }
     }`,
    { first },
  );
  const nodes = data.shopifyPaymentsAccount?.disputes.nodes ?? [];
  return nodes.map((d) => ({
    id: d.id,
    evidenceId: d.disputeEvidence?.id ?? null,
    amount: d.amount?.amount ?? null,
    currency: d.amount?.currencyCode ?? null,
    status: d.status,
    type: d.type,
    reason: d.reasonDetails?.reason ?? null,
    reasonCode: d.reasonDetails?.networkReasonCode ?? null,
    evidenceDueBy: d.evidenceDueBy,
    evidenceSentOn: d.evidenceSentOn,
    finalizedOn: d.finalizedOn,
    initiatedAt: d.initiatedAt,
    orderId: d.order?.id ?? null,
    orderName: d.order?.name ?? null,
    customerEmail: d.order?.email ?? null,
    customerName: d.order?.customer?.displayName ?? null,
  }));
}

export type DisputeEvidenceInput = {
  customerEmailAddress?: string;
  customerFirstName?: string;
  customerLastName?: string;
  uncategorizedText?: string;
  accessActivityLog?: string;
  cancellationRebuttal?: string;
  refundPolicyDisclosure?: string;
  refundRefusalExplanation?: string;
};

/** Beweis-Evidence aktualisieren und optional einreichen (submit=true ist geldbewegend). */
export async function submitDisputeEvidence(
  creds: ShopifyCreds,
  evidenceId: string,
  input: DisputeEvidenceInput,
  submit: boolean,
): Promise<{ ok: boolean; errors: string[]; evidenceSentOn: string | null; status: string | null }> {
  const data = await gql<{
    disputeEvidenceUpdate: {
      disputeEvidence: { dispute: { evidenceSentOn: string | null; status: string } } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    creds,
    `mutation($id: ID!, $input: ShopifyPaymentsDisputeEvidenceUpdateInput!) {
       disputeEvidenceUpdate(id: $id, input: $input) {
         disputeEvidence { dispute { evidenceSentOn status } }
         userErrors { field message }
       }
     }`,
    { id: evidenceId, input: { ...input, submitEvidence: submit } },
  );
  const errors = (data.disputeEvidenceUpdate.userErrors ?? []).map((e) => e.message);
  return {
    ok: errors.length === 0,
    errors,
    evidenceSentOn: data.disputeEvidenceUpdate.disputeEvidence?.dispute?.evidenceSentOn ?? null,
    status: data.disputeEvidenceUpdate.disputeEvidence?.dispute?.status ?? null,
  };
}

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

/**
 * Erstattet einen Betrag (Hauptwährung, z. B. "12.30") auf eine Bestellung.
 * Sucht die erfolgreiche Zahlungs-Transaktion (SALE/CAPTURE) und bucht dagegen eine REFUND-Transaktion.
 * Shopify lehnt Über-Erstattungen selbst ab (zusätzliche Sicherheitsnetz).
 */
export async function refundOrderAmount(
  creds: ShopifyCreds,
  orderId: string,
  amount: string,
  note: string,
): Promise<{ refundedAmount: string; currency: string }> {
  const q = `query($id: ID!) {
    order(id: $id) {
      currencyCode
      totalRefundedSet { shopMoney { amount } }
      totalReceivedSet { shopMoney { amount } }
      transactions(first: 30) { id kind status gateway }
      refunds(first: 20) { createdAt totalRefundedSet { shopMoney { amount } } }
    }
  }`;
  const d = await gql<{
    order: {
      currencyCode: string;
      totalRefundedSet: { shopMoney: { amount: string } } | null;
      totalReceivedSet: { shopMoney: { amount: string } } | null;
      transactions: { id: string; kind: string; status: string; gateway: string }[];
      refunds: { createdAt: string; totalRefundedSet: { shopMoney: { amount: string } } | null }[];
    } | null;
  }>(creds, q, { id: orderId });

  const order = d.order;
  if (!order) throw new ShopifyError("Bestellung nicht gefunden");
  // Doppel-Schutz: wurde genau dieser Betrag in den letzten 15 Minuten schon erstattet (z. B. Klick nach
  // unklarem Fehler)? Dann NICHT nochmal — erst in Shopify prüfen.
  const dup = (order.refunds ?? []).find(
    (r) => Math.abs(Number(r.totalRefundedSet?.shopMoney.amount ?? "0") - Number(amount)) < 0.005 && Date.now() - new Date(r.createdAt).getTime() < 15 * 60_000,
  );
  if (dup) {
    throw new ShopifyError(
      `Dieser Betrag (${amount} ${order.currencyCode}) wurde vor ${Math.max(1, Math.round((Date.now() - new Date(dup.createdAt).getTime()) / 60_000))} Min. schon erstattet. Zur Sicherheit nicht doppelt. Bitte in Shopify prüfen.`,
    );
  }
  const parent = order.transactions.find(
    (t) => (t.kind === "SALE" || t.kind === "CAPTURE") && t.status === "SUCCESS",
  );
  if (!parent) throw new ShopifyError("Keine erstattbare Zahlung gefunden (evtl. manuell/unbezahlt).");

  // Verbleibend erstattbar grob prüfen (harte Prüfung macht Shopify).
  const received = Number(order.totalReceivedSet?.shopMoney.amount ?? "0");
  const refunded = Number(order.totalRefundedSet?.shopMoney.amount ?? "0");
  const remaining = received - refunded;
  if (Number(amount) > remaining + 0.001) {
    throw new ShopifyError(
      `Betrag zu hoch: max. erstattbar sind ${remaining.toFixed(2)} ${order.currencyCode}.`,
    );
  }

  const m = `mutation($input: RefundInput!) {
    refundCreate(input: $input) {
      refund { id totalRefundedSet { shopMoney { amount currencyCode } } }
      userErrors { field message }
    }
  }`;
  const input = {
    orderId,
    note,
    notify: false, // wir schicken unsere eigene Mail
    transactions: [{ orderId, gateway: parent.gateway, kind: "REFUND", amount, parentId: parent.id }],
  };
  const r = await gql<{
    refundCreate: {
      refund: { id: string; totalRefundedSet: { shopMoney: Money } } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(creds, m, { input });
  if (r.refundCreate.userErrors?.length) throw new ShopifyError(r.refundCreate.userErrors[0].message);
  const money = r.refundCreate.refund?.totalRefundedSet?.shopMoney;
  return { refundedAmount: money?.amount ?? amount, currency: money?.currencyCode ?? order.currencyCode };
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

/** Bestellungen direkt über die E-Mail (fängt Gast-Checkouts ohne Kundenkonto). */
export async function findOrdersByEmail(creds: ShopifyCreds, email: string, first = 5): Promise<ShopifyOrder[]> {
  const clean = email.trim();
  if (!clean) return [];
  const data = await gql<{ orders: { nodes: any[] } }>(
    creds,
    `query($q: String!, $first: Int!) { orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${ORDER_FIELDS} customer { ${CUSTOMER_FIELDS} } } } }`,
    { q: `email:${clean}`, first },
  );
  return (data.orders?.nodes ?? []).map(mapOrder);
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

/** Zahlungs-Transaktionen einer Bestellung (für den PayPal-Abgleich: steckt die PayPal-Transaktions-ID drin?). */
export async function getOrderPaymentRefs(creds: ShopifyCreds, orderGid: string): Promise<string[]> {
  const data = await gql<{ order: { transactions: { gateway: string | null; authorizationCode: string | null; receiptJson: string | null }[] } | null }>(
    creds,
    `query($id: ID!) { order(id: $id) { transactions(first: 20) { gateway authorizationCode receiptJson } } }`,
    { id: orderGid },
  );
  const refs: string[] = [];
  for (const t of data.order?.transactions ?? []) {
    if (t.authorizationCode) refs.push(t.authorizationCode);
    if (t.receiptJson) refs.push(t.receiptJson);
  }
  return refs;
}
