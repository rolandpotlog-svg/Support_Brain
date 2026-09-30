// PayPal-Käuferschutzfälle je Shop abholen, der Shopify-Bestellung + dem Support-Ticket zuordnen und als
// Fall (dispute_case, source 'paypal') speichern. Nur LESEN — Antworten an PayPal gibt ein Mensch frei.
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";
import { loadShopifyCreds } from "@/server/shopify-config";
import { findOrdersByEmail, getOrderByName, getOrderPaymentRefs, type ShopifyOrder } from "@/lib/shopify/client";
import { getPaypalDispute, listPaypalDisputes, paypalToken, type PaypalCreds, type PaypalDisputeDetail } from "@/lib/paypal/client";

/** PayPal-Grund -> interne Kategorie (Texte/Empfehlungen in src/lib/disputes/reasons.ts). */
const REASON_MAP: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "PRODUCT_NOT_RECEIVED",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "PRODUCT_UNACCEPTABLE",
  UNAUTHORISED: "FRAUDULENT",
  UNAUTHORIZED_TRANSACTION: "FRAUDULENT",
  CREDIT_NOT_PROCESSED: "CREDIT_NOT_PROCESSED",
  DUPLICATE_TRANSACTION: "DUPLICATE",
  CANCELED_RECURRING_BILLING: "SUBSCRIPTION_CANCELLED",
};

/** PayPal-Status -> Status der Fall-Übersicht (NEEDS_RESPONSE / UNDER_REVIEW / WON / LOST). */
function mapStatus(d: PaypalDisputeDetail): { status: string; outcome: "won" | "lost" | null } {
  const oc = d.outcome?.outcome_code ?? "";
  if (d.status === "RESOLVED" || d.dispute_state === "RESOLVED") {
    if (oc.includes("SELLER_FAVOUR") || oc.includes("SELLER_FAVOR")) return { status: "WON", outcome: "won" };
    if (oc.includes("BUYER_FAVOUR") || oc.includes("BUYER_FAVOR") || oc === "ACCEPTED") return { status: "LOST", outcome: "lost" };
    return { status: "RESOLVED", outcome: null };
  }
  if (d.status === "WAITING_FOR_SELLER_RESPONSE" || d.status === "OPEN") return { status: "NEEDS_RESPONSE", outcome: null };
  return { status: "UNDER_REVIEW", outcome: null };
}

export async function loadPaypalCreds(shopId: string): Promise<PaypalCreds | null> {
  const row = await db.query.shopPaypal.findFirst({ where: eq(schema.shopPaypal.shopId, shopId) });
  if (!row) return null;
  return { clientId: row.clientId, clientSecret: decrypt(row.clientSecretEnc), mode: row.mode === "live" ? "live" : "sandbox" };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.05;

/** Fall -> Shopify-Bestellung. sicher = PayPal-Transaktions-ID in den Zahlungsdaten; wahrscheinlich = E-Mail+Betrag+Datum. */
async function matchOrder(
  shopId: string,
  d: PaypalDisputeDetail,
): Promise<{ order: ShopifyOrder | null; confidence: "sicher" | "wahrscheinlich" | "keine"; note: string }> {
  const creds = await loadShopifyCreds(shopId);
  const tx = d.transactions[0];
  if (!creds || !tx) return { order: null, confidence: "keine", note: creds ? "Keine Transaktion im Fall" : "Shopify nicht verbunden" };
  const amount = Number(tx.amount?.value ?? d.dispute_amount?.value ?? 0);
  const verify = async (o: ShopifyOrder) => {
    if (!tx.sellerTransactionId) return false;
    try {
      return (await getOrderPaymentRefs(creds, o.id)).some((r) => r.includes(tx.sellerTransactionId!));
    } catch {
      return false;
    }
  };

  // 1) Rechnungsnummer/Custom sieht wie eine Bestellnummer aus
  for (const ref of [tx.invoiceNumber, tx.custom]) {
    const num = ref?.match(/#?(\d{3,})/)?.[1];
    if (!num) continue;
    const hit = await getOrderByName(creds, num).catch(() => null);
    if (hit && (!amount || near(Number(hit.order.total?.amount ?? 0), amount))) {
      return (await verify(hit.order))
        ? { order: hit.order, confidence: "sicher", note: "PayPal-Transaktion in der Bestellung gefunden" }
        : { order: hit.order, confidence: "wahrscheinlich", note: `Rechnungsnummer ${ref} + Betrag passen` };
    }
  }
  // 2) Käufer-E-Mail -> Bestellungen mit passendem Betrag + Datum (± 3 Tage)
  if (tx.buyerEmail) {
    const orders = await findOrdersByEmail(creds, tx.buyerEmail, 10).catch(() => [] as ShopifyOrder[]);
    const t0 = tx.createTime ? new Date(tx.createTime).getTime() : null;
    const cands = orders.filter(
      (o) =>
        (!amount || near(Number(o.total?.amount ?? 0), amount)) &&
        (!t0 || Math.abs(new Date(o.createdAt).getTime() - t0) < 3 * 86_400_000),
    );
    for (const o of cands) if (await verify(o)) return { order: o, confidence: "sicher", note: "PayPal-Transaktion in der Bestellung gefunden" };
    if (cands.length === 1) return { order: cands[0], confidence: "wahrscheinlich", note: "Käufer-E-Mail, Betrag und Datum passen" };
    if (cands.length > 1) return { order: null, confidence: "keine", note: `${cands.length} mögliche Bestellungen — bitte manuell zuordnen` };
  }
  return { order: null, confidence: "keine", note: "Keine passende Bestellung gefunden" };
}

/** Alle PayPal-Fälle der letzten ~170 Tage holen und speichern. */
export async function syncPaypalDisputes(shopId: string): Promise<{ count: number }> {
  const c = await loadPaypalCreds(shopId);
  if (!c) return { count: 0 };
  try {
    const { token } = await paypalToken(c);
    const since = new Date(Date.now() - 170 * 86_400_000).toISOString();
    const list = await listPaypalDisputes(c, token, since);
    for (const s of list) {
      const d = await getPaypalDispute(c, token, s.dispute_id);
      const tx = d.transactions[0];
      const { status, outcome } = mapStatus(d);
      const m = await matchOrder(shopId, d);
      // Ticket: gleiche Bestellnummer (sicher zugeordnet) oder gleiche Käufer-E-Mail im selben Shop
      let threadId: string | null = null;
      if (m.order || tx?.buyerEmail) {
        const t = await db
          .select({ id: schema.threads.id })
          .from(schema.threads)
          .where(
            and(
              eq(schema.threads.shopId, shopId),
              m.order
                ? sql`(${schema.threads.orderName} = ${m.order.name} or lower(${schema.threads.customerEmail}) = lower(${tx?.buyerEmail ?? ""}))`
                : sql`lower(${schema.threads.customerEmail}) = lower(${tx?.buyerEmail ?? ""})`,
            ),
          )
          .orderBy(desc(schema.threads.lastMessageAt))
          .limit(1);
        threadId = t[0]?.id ?? null;
      }
      const vals = {
        orderId: m.order?.id ?? null,
        orderName: m.order?.name ?? null,
        threadId,
        customerEmail: tx?.buyerEmail ?? m.order?.email ?? null,
        customerName: tx?.buyerName ?? m.order?.shippingAddress?.name ?? null,
        amount: d.dispute_amount?.value ?? tx?.amount?.value ?? null,
        currency: d.dispute_amount?.currency_code ?? tx?.amount?.currency_code ?? null,
        reason: REASON_MAP[d.reason] ?? "GENERAL",
        reasonCode: d.reason,
        type: d.dispute_life_cycle_stage ?? null,
        status,
        outcome,
        dueBy: d.seller_response_due_date ? new Date(d.seller_response_due_date) : null,
        initiatedAt: d.create_time ? new Date(d.create_time) : null,
        externalUrl:
          c.mode === "live"
            ? `https://www.paypal.com/resolutioncenter/view/${d.dispute_id}`
            : `https://www.sandbox.paypal.com/resolutioncenter/view/${d.dispute_id}`,
        matchConfidence: m.confidence,
        matchNote: m.note,
        raw: d.raw,
        updatedAt: new Date(),
      };
      await db
        .insert(schema.disputeCase)
        .values({ shopId, source: "paypal", providerCaseId: d.dispute_id, ...vals })
        .onConflictDoUpdate({
          target: [schema.disputeCase.shopId, schema.disputeCase.source, schema.disputeCase.providerCaseId],
          set: vals,
        });
    }
    await db.update(schema.shopPaypal).set({ lastSyncAt: new Date(), lastError: null }).where(eq(schema.shopPaypal.shopId, shopId));
    return { count: list.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Auch bei Fehler den Zeitpunkt merken -> kein Dauer-Anklopfen bei falschen Zugangsdaten (nächster Versuch in 30 Min.)
    await db.update(schema.shopPaypal).set({ lastError: msg.slice(0, 300), lastSyncAt: new Date() }).where(eq(schema.shopPaypal.shopId, shopId));
    throw e;
  }
}

/** Worker: alle Shops mit PayPal-Zugang (höchstens alle 30 Minuten). */
export async function syncAllPaypal(): Promise<number> {
  const rows = await db.select({ shopId: schema.shopPaypal.shopId, last: schema.shopPaypal.lastSyncAt }).from(schema.shopPaypal);
  let n = 0;
  for (const r of rows) {
    if (r.last && Date.now() - r.last.getTime() < 30 * 60_000) continue;
    try {
      n += (await syncPaypalDisputes(r.shopId)).count;
    } catch (e) {
      console.error(`[paypal] ${r.shopId}:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}
