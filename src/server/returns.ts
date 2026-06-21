// Retouren-Portal: Server-Logik (Portal-Verifikation, Angebote, Fälle, Aufgaben,
// Deep-Links, Guardrails). Nutzt die bestehende Shopify-Verbindung + das Ticket-System mit.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getOrderByName, type ShopifyOrder } from "@/lib/shopify/client";
import { isRouting, ROUTING_LABEL, type Routing } from "@/lib/returns/routing";
import {
  centsToAmount,
  type EconParams,
  isHighValue,
  lineValueCents,
  maxKeepRefundCents,
  offerLadderCents,
  voucherValueCents,
} from "@/lib/returns/economics";

export type ReturnSettings = typeof schema.returnSettings.$inferSelect;

export function fmtMoney(cents: number, currency: string): string {
  return `${centsToAmount(cents)} ${currency === "EUR" ? "€" : currency}`;
}

export function econFromSettings(s: ReturnSettings): EconParams {
  return {
    cogsPct: s.cogsPct,
    returnShippingCents: s.returnShippingCents,
    resaleableDefault: s.resaleableDefault,
    voucherBonusPct: s.voucherBonusPct,
    firstOfferPct: s.firstOfferPct,
    highValueThresholdCents: s.highValueThresholdCents,
  };
}

export async function getSettings(shopId: string): Promise<ReturnSettings | null> {
  return (await db.query.returnSettings.findFirst({ where: eq(schema.returnSettings.shopId, shopId) })) ?? null;
}

export type PortalReason = { id: string; label: string; routing: Routing };
export type PortalShop = {
  shopId: string;
  shopName: string;
  accentColor: string;
  currency: string;
  reasons: PortalReason[];
};

/** Lädt einen Shop fürs öffentliche Portal (nur wenn aktiv + Portal aktiviert). */
export async function loadPortalShop(slug: string): Promise<PortalShop | null> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.slug, slug) });
  if (!shop || !shop.active) return null;
  const settings = await getSettings(shop.id);
  if (!settings || !settings.enabled) return null;
  const reasons = await db
    .select()
    .from(schema.returnReasons)
    .where(and(eq(schema.returnReasons.shopId, shop.id), eq(schema.returnReasons.active, true)))
    .orderBy(schema.returnReasons.sortOrder);
  return {
    shopId: shop.id,
    shopName: shop.name,
    accentColor: settings.accentColor,
    currency: settings.currency,
    reasons: reasons
      .filter((r) => isRouting(r.routing))
      .map((r) => ({ id: r.id, label: r.label, routing: r.routing as Routing })),
  };
}

export type PortalItem = {
  title: string;
  variantTitle: string | null;
  quantity: number;
  unitPriceCents: number;
  imageUrl: string | null;
};

function toCents(amount: string | null | undefined): number {
  return amount ? Math.round(parseFloat(amount) * 100) : 0;
}

/** Bestellung über die bestehende Shopify-Verbindung laden + E-Mail abgleichen. */
export async function verifyAndLoadOrder(
  shopId: string,
  orderName: string,
  email: string,
): Promise<{ order: ShopifyOrder; items: PortalItem[] } | null> {
  const creds = await loadShopifyCreds(shopId);
  if (!creds) return null;
  const res = await getOrderByName(creds, orderName);
  if (!res) return null;
  const orderEmail = (res.order.email ?? res.customer?.email ?? "").toLowerCase().trim();
  if (!orderEmail || orderEmail !== email.toLowerCase().trim()) return null;
  const items = res.order.lineItems.map((li) => ({
    title: li.title,
    variantTitle: li.variantTitle,
    quantity: li.quantity,
    unitPriceCents: toCents(li.price?.amount),
    imageUrl: li.imageUrl,
  }));
  return { order: res.order, items };
}

export type OfferType = "partial_refund" | "voucher" | "exchange" | "none" | "return";
export type Offer = {
  step: number;
  routing: Routing;
  type: OfferType;
  valueCents: number;
  altVoucherCents: number | null; // alternatives Guthaben-Angebot (nur bei keep_refund)
  message: string;
  canDecline: boolean;
};

/** Ermittelt das Angebot für einen Schritt der Eskalationsleiter. */
export function buildOffer(
  routing: Routing,
  item: PortalItem,
  qty: number,
  step: number,
  econ: EconParams,
  currency: string,
): Offer {
  const value = lineValueCents(item.unitPriceCents, qty);
  const base = { step, routing } as const;

  if (routing === "support_redirect") {
    return {
      ...base,
      type: "none",
      valueCents: 0,
      altVoucherCents: null,
      canDecline: false,
      message:
        "Bei nicht angekommenen oder verspäteten Sendungen hilft eine Rückgabe nicht weiter. Wir leiten deine Anfrage direkt an unseren Support und das Tracking weiter und melden uns.",
    };
  }

  if (routing === "exchange") {
    if (step === 0) {
      return {
        ...base,
        type: "exchange",
        valueCents: 0,
        altVoucherCents: null,
        canDecline: true,
        message:
          "Wir schicken dir kostenlos die richtige Variante. Den falschen Artikel musst du in der Regel nicht zurückschicken.",
      };
    }
    return {
      ...base,
      type: "return",
      valueCents: 0,
      altVoucherCents: null,
      canDecline: false,
      message: "Alles klar — dann nimm den Artikel regulär zurück. Wir senden dir die Rücksendeinfos.",
    };
  }

  if (routing === "defect_photo") {
    return {
      ...base,
      type: "partial_refund",
      valueCents: value,
      altVoucherCents: null,
      canDecline: false,
      message: `Bei einem Defekt musst du nichts zurückschicken. Wir erstatten dir ${fmtMoney(
        value,
        currency,
      )} und melden den Defekt unserem Lieferanten. Ein Foto hilft uns — gerne per Antwortmail.`,
    };
  }

  // keep_refund
  if (isHighValue(item.unitPriceCents, qty, econ)) {
    return {
      ...base,
      type: "return",
      valueCents: 0,
      altVoucherCents: null,
      canDecline: false,
      message: "Dieser Artikel wird regulär zurückgenommen — wir senden dir gleich die Rücksendeinfos.",
    };
  }
  const ladder = offerLadderCents(maxKeepRefundCents(item.unitPriceCents, qty, econ), econ);
  if (step < ladder.length) {
    const cash = ladder[step];
    return {
      ...base,
      type: "partial_refund",
      valueCents: cash,
      altVoucherCents: voucherValueCents(cash, econ),
      canDecline: true,
      message: `Behalte den Artikel und erhalte ${fmtMoney(
        cash,
        currency,
      )} zurück — keine Rücksendung nötig. Oder ${fmtMoney(
        voucherValueCents(cash, econ),
        currency,
      )} Guthaben für deinen nächsten Einkauf.`,
    };
  }
  return {
    ...base,
    type: "return",
    valueCents: 0,
    altVoucherCents: null,
    canDecline: false,
    message: "Kein Problem — dann nimm den Artikel regulär zurück. Wir senden dir die Rücksendeinfos.",
  };
}

function numericId(gid: string | null): string {
  return gid?.split("/").pop() ?? "";
}

/** Summe der bereits gewährten „Behalten"-Erstattungen eines Kunden im Zeitfenster (Betrugslimit). */
async function keepUsedCents(shopId: string, email: string, windowDays: number): Promise<number> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({ v: sql<number>`coalesce(sum(${schema.returnCases.acceptedValueCents}),0)::int` })
    .from(schema.returnCases)
    .where(
      and(
        eq(schema.returnCases.shopId, shopId),
        eq(schema.returnCases.customerEmail, email.toLowerCase()),
        eq(schema.returnCases.outcome, "deflected_keep"),
        gte(schema.returnCases.createdAt, since),
      ),
    );
  return rows[0]?.v ?? 0;
}

export type AcceptInput = {
  shopId: string;
  settings: ReturnSettings;
  order: ShopifyOrder;
  item: PortalItem;
  qty: number;
  reason: PortalReason;
  offer: Offer;
  acceptVoucher: boolean; // bei keep_refund: Guthaben statt Cash gewählt
};

/** Erstellt den Fall + die geld-bewegenden Aufgaben (Verlinkungs-Modus) + ggf. Ticket. */
export async function createReturnCase(input: AcceptInput): Promise<{ number: number }> {
  const { shopId, settings, order, item, qty, reason, offer } = input;
  const creds = await loadShopifyCreds(shopId);
  const domain = creds?.domain ?? "";
  const adminBase = `https://${domain}/admin`;
  const orderUrl = `${adminBase}/orders/${numericId(order.id)}`;
  const currency = settings.currency;
  const value = lineValueCents(item.unitPriceCents, qty);

  // Guardrail: Betrugslimit -> Behalten ggf. auf physische Retoure zurückstufen.
  let type = offer.type;
  let acceptedCents = type === "voucher" ? offer.altVoucherCents ?? offer.valueCents : offer.valueCents;
  if (input.acceptVoucher && type === "partial_refund") {
    type = "voucher";
    acceptedCents = offer.altVoucherCents ?? offer.valueCents;
  }
  if ((type === "partial_refund" || type === "voucher") && reason.routing === "keep_refund") {
    const used = await keepUsedCents(shopId, order.email ?? input.order.email ?? "", settings.fraudWindowDays);
    if (used + acceptedCents > settings.fraudMaxKeepCents) {
      type = "return";
      acceptedCents = 0;
    }
  }

  const outcome =
    type === "partial_refund"
      ? reason.routing === "defect_photo"
        ? "refunded"
        : "deflected_keep"
      : type === "voucher"
        ? "deflected_keep"
        : type === "exchange"
          ? "exchanged"
          : type === "return"
            ? "returned"
            : "redirected";
  const recovered = type === "partial_refund" || type === "voucher" ? Math.max(0, value - acceptedCents) : 0;

  const itemRow = {
    title: item.title,
    variantTitle: item.variantTitle,
    quantity: qty,
    unitPriceCents: item.unitPriceCents,
    reasonLabel: reason.label,
    routing: reason.routing,
  };

  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.returnCases)
      .values({
        shopId,
        orderGid: order.id,
        orderName: order.name,
        customerEmail: (order.email ?? "").toLowerCase(),
        status: type === "none" ? "redirected" : "accepted",
        reasonRouting: reason.routing,
        items: [itemRow],
        offerType: offer.type,
        offerValueCents: offer.valueCents,
        offerStep: offer.step,
        acceptedOfferType: type,
        acceptedValueCents: acceptedCents,
        recoveredValueCents: recovered,
        outcome,
      })
      .returning({ id: schema.returnCases.id, number: schema.returnCases.number });

    const tasks: (typeof schema.returnTasks.$inferInsert)[] = [];
    const add = (t: Omit<typeof schema.returnTasks.$inferInsert, "caseId" | "shopId">) =>
      tasks.push({ caseId: c.id, shopId, ...t });

    if (type === "partial_refund") {
      add({
        type: "refund",
        title: `Erstattung ${fmtMoney(acceptedCents, currency)} · ${order.name}`,
        amountCents: acceptedCents,
        deepLink: orderUrl,
        instruction: `Erstatte ${fmtMoney(acceptedCents, currency)} auf ${order.name} (Kunde behält „${item.title}").`,
      });
    } else if (type === "voucher") {
      add({
        type: "discount_code",
        title: `Gutschein ${fmtMoney(acceptedCents, currency)} · ${order.name}`,
        amountCents: acceptedCents,
        deepLink: `${adminBase}/discounts`,
        instruction: `Rabattcode über ${fmtMoney(acceptedCents, currency)} anlegen und an ${order.email} mailen.`,
      });
    } else if (type === "exchange") {
      add({
        type: "draft_order",
        title: `Umtausch · ${order.name}`,
        amountCents: null,
        deepLink: `${adminBase}/draft_orders/new`,
        instruction: `Entwurfsbestellung: richtige Variante von „${item.title}" an ${order.email} senden.`,
      });
    } else if (type === "return") {
      add({
        type: "refund",
        title: `Rücksendung bearbeiten · ${order.name}`,
        amountCents: value,
        deepLink: orderUrl,
        instruction: `Rücksendung organisieren (Label/Adresse senden); nach Eingang ${fmtMoney(value, currency)} erstatten.`,
      });
    }

    if (reason.routing === "defect_photo") {
      add({
        type: "supplier_claim",
        title: `Lieferanten-Reklamation · ${item.title}`,
        amountCents: null,
        deepLink: null,
        instruction: `Defekt bei „${item.title}" (${order.name}) beim Lieferanten reklamieren. Foto ggf. beim Kunden anfordern.`,
      });
    }

    if (tasks.length) await tx.insert(schema.returnTasks).values(tasks);
    return { number: c.number };
  });
}
