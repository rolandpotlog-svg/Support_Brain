// PayPal-Fälle: Fakten aus der Shopify-Bestellung + Empfehlung, die den PayPal-Score schützt.
// Grundsatz (Roland): lieber kulant lösen als Fälle verlieren — verlorene Fälle drücken das Verkäuferkonto.
// Kämpfen nur mit klarem Beleg (sicher zugeordnet + Zustellung belegt). Reine Logik (Client + Server).
import { customerTracking, trackingUrl, type ShopifyOrder } from "@/lib/shopify/client";

/** Unter diesem Betrag im Zweifel erstatten statt diskutieren. */
export const KULANZ_EUR = 30;

export type CaseFacts = {
  orderDate: string | null;
  total: string | null;
  items: string[];
  personalized: boolean;
  financialStatus: string | null; // PAID | REFUNDED | PARTIALLY_REFUNDED …
  fulfillment: string | null; // FULFILLED | UNFULFILLED …
  delivery: string | null; // DELIVERED | IN_TRANSIT … (letzte Sendung)
  deliveredAt: string | null;
  tracking: { company: string | null; number: string | null; url: string | null }[];
  shipTo: string | null;
  checkedAt: string;
};

export function factsFromOrder(o: ShopifyOrder): CaseFacts {
  return {
    orderDate: o.createdAt ?? null,
    total: o.total ? `${o.total.amount} ${o.total.currencyCode}` : null,
    items: o.lineItems.map(
      (li) =>
        `${li.quantity}× ${li.title}${li.variantTitle ? ` (${li.variantTitle})` : ""}${li.properties.length ? ` · ${li.properties.map((p) => `${p.key}: ${p.value}`).join("; ")}` : ""}`,
    ),
    personalized: o.lineItems.some((li) => li.properties.length > 0),
    financialStatus: o.financialStatus,
    fulfillment: o.fulfillmentStatus,
    delivery: o.delivery?.status ?? null,
    deliveredAt: o.delivery?.deliveredAt ?? null,
    tracking: customerTracking(o.tracking).map((t) => ({ ...t, url: trackingUrl(t) })),
    shipTo: o.shippingAddress
      ? [o.shippingAddress.name, o.shippingAddress.address1, [o.shippingAddress.zip, o.shippingAddress.city].filter(Boolean).join(" "), o.shippingAddress.country]
          .filter(Boolean)
          .join(", ")
      : null,
    checkedAt: new Date().toISOString(),
  };
}

export type AdviceAction = "loesen" | "erstatten" | "kaempfen";
export type Advice = { action: AdviceAction; label: string; why: string };

export const ADVICE_LABEL: Record<AdviceAction, string> = {
  loesen: "Mit Käufer lösen",
  erstatten: "Kulant erstatten",
  kaempfen: "Mit Beleg verteidigen",
};

/** PayPal-Phasen: INQUIRY = Anfrage (noch kein Konflikt beim Käuferschutz) -> hier lösen, bevor es eskaliert. */
export function stageLabel(stage?: string | null): string {
  switch ((stage ?? "").toUpperCase()) {
    case "INQUIRY": return "Anfrage";
    case "CHARGEBACK": return "Konflikt";
    case "PRE_ARBITRATION": return "Vorprüfung";
    case "ARBITRATION": return "Entscheidung PayPal";
    default: return stage ?? "—";
  }
}

export function paypalAdvice(c: {
  amount: string | null;
  reason: string | null;
  stage: string | null;
  matchConfidence: string | null;
  facts: CaseFacts | null;
}): Advice {
  const amount = parseFloat(c.amount ?? "0") || 0;
  const f = c.facts;
  const sure = c.matchConfidence === "sicher";
  const delivered = sure && (f?.delivery ?? "").toUpperCase() === "DELIVERED";
  const hasTracking = Boolean(f?.tracking?.some((t) => t.number));
  const inTransit = ["IN_TRANSIT", "OUT_FOR_DELIVERY", "CONFIRMED", "LABEL_PRINTED", "READY_FOR_PICKUP"].includes((f?.delivery ?? "").toUpperCase());
  const refunded = (f?.financialStatus ?? "").toUpperCase().includes("REFUNDED");
  const inquiry = (c.stage ?? "").toUpperCase() === "INQUIRY";
  const small = amount > 0 && amount < KULANZ_EUR;
  const A = (action: AdviceAction, why: string): Advice => ({ action, label: ADVICE_LABEL[action], why });

  if (!f && !sure) return A(small ? "erstatten" : "loesen", "Bestellung nicht sicher zugeordnet: erst zuordnen, bis dahin freundlich mit dem Käufer klären.");

  switch (c.reason) {
    case "PRODUCT_NOT_RECEIVED":
      if (delivered) {
        return inquiry
          ? A("loesen", "Zustellung ist belegt: Käufer freundlich Sendungsverfolgung + Zustelldatum schicken und bitten, bei Nachbarn/Briefkasten nachzusehen. Klärt sich meist ohne Konflikt.")
          : A("kaempfen", "Zustellung an die Bestelladresse ist belegt: mit Sendungsverfolgung verteidigen.");
      }
      if (inTransit) return A("loesen", "Sendung ist noch unterwegs: Käufer den aktuellen Stand zeigen und um wenige Tage Geduld bitten, Ersatz zusagen, falls nichts ankommt.");
      if (hasTracking) return A(small ? "erstatten" : "loesen", "Tracking vorhanden, aber keine Zustellung belegt: Nachforschung anbieten oder Ersatz schicken, nicht kämpfen.");
      return A("erstatten", "Kein Versand-/Zustellnachweis: verlorener Fall wäre sicher. Kulant erstatten oder neu senden.");
    case "PRODUCT_UNACCEPTABLE":
      return small
        ? A("erstatten", "Kleinbetrag + Reklamation: kulant erstatten, ohne Rücksendung. Schützt den Score.")
        : A("loesen", "Reklamation: Ersatz oder Teilerstattung anbieten (ggf. Foto erbitten). Kämpfen nur bei klarer Fehlbedienung.");
    case "FRAUDULENT":
      return delivered
        ? A("kaempfen", "Ware wurde an die Bestelladresse zugestellt: mit Zustellnachweis verteidigen.")
        : A("erstatten", "Nicht autorisierte Zahlung ohne belegte Zustellung: kaum zu gewinnen, erstatten.");
    case "CREDIT_NOT_PROCESSED":
      return refunded
        ? A("kaempfen", "Erstattung ist laut Shopify bereits erfolgt: Nachweis der Rückzahlung beilegen.")
        : A("erstatten", "Zugesagte Erstattung fehlt: jetzt erstatten.");
    case "DUPLICATE":
      return A("erstatten", "Doppelbelastung prüfen; wenn doppelt, sofort erstatten.");
    default:
      return small ? A("erstatten", "Kleinbetrag: kulant erstatten schützt den Score.") : A("loesen", "Mit dem Käufer klären, bevor PayPal entscheidet.");
  }
}
