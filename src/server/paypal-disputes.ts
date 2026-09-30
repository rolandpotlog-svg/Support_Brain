// PayPal-Käuferschutzfälle je Shop abholen, der Shopify-Bestellung + dem Support-Ticket zuordnen und als
// Fall (dispute_case, source 'paypal') speichern. Nur LESEN — Antworten an PayPal gibt ein Mensch frei.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { decrypt } from "@/lib/mailbox/crypto";
import { loadShopifyCreds } from "@/server/shopify-config";
import { findOrdersByEmail, getOrderByName, getOrderPaymentRefs, type ShopifyOrder } from "@/lib/shopify/client";
import { factsFromOrder } from "@/lib/disputes/paypal-policy";
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

/** Shops, die dasselbe PayPal-Konto nutzen (gleiche Client-ID + Modus) — z. B. Repello + Lovenja. */
async function paypalGroup(shopId: string): Promise<{ creds: PaypalCreds; shopIds: string[] } | null> {
  const row = await db.query.shopPaypal.findFirst({ where: eq(schema.shopPaypal.shopId, shopId) });
  if (!row) return null;
  const same = await db
    .select({ shopId: schema.shopPaypal.shopId })
    .from(schema.shopPaypal)
    .where(and(eq(schema.shopPaypal.clientId, row.clientId), eq(schema.shopPaypal.mode, row.mode)))
    .orderBy(schema.shopPaypal.shopId);
  return {
    creds: { clientId: row.clientId, clientSecret: decrypt(row.clientSecretEnc), mode: row.mode === "live" ? "live" : "sandbox" },
    shopIds: same.map((r) => r.shopId),
  };
}

/** Andere Shops mit demselben PayPal-Konto (für den Hinweis in der Shop-Verwaltung). */
export async function paypalSiblingShops(shopId: string): Promise<{ id: string; name: string }[]> {
  const g = await paypalGroup(shopId);
  if (!g || g.shopIds.length < 2) return [];
  const shops = await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops);
  return shops.filter((s) => s.id !== shopId && g.shopIds.includes(s.id));
}

async function findThread(shopId: string, orderName: string | null, email: string | null): Promise<string | null> {
  if (!orderName && !email) return null;
  const t = await db
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        orderName
          ? sql`(${schema.threads.orderName} = ${orderName} or lower(${schema.threads.customerEmail}) = lower(${email ?? ""}))`
          : sql`lower(${schema.threads.customerEmail}) = lower(${email ?? ""})`,
      ),
    )
    .orderBy(desc(schema.threads.lastMessageAt))
    .limit(1);
  return t[0]?.id ?? null;
}

type Match = Awaited<ReturnType<typeof matchOrder>>;
const RANK = { sicher: 2, wahrscheinlich: 1, keine: 0 } as const;

/**
 * Welcher Shop gehört zu diesem Fall? Bei einem Konto für mehrere Shops wird in jedem Shop gesucht:
 * 1) PayPal-Transaktion in genau einer Bestellung (sicher) · 2) nur ein Shop „wahrscheinlich“ ·
 * 3) Käufer hat nur in einem Shop ein Ticket · sonst bleibt der bisherige Shop bzw. der erste — mit Hinweis.
 */
async function pickShop(
  shopIds: string[],
  d: PaypalDisputeDetail,
  currentShopId: string | null,
): Promise<{ shopId: string; m: Match; threadId: string | null }> {
  const email = d.transactions[0]?.buyerEmail ?? null;
  const res = await Promise.all(
    shopIds.map(async (id) => {
      const m = await matchOrder(id, d);
      return { shopId: id, m, threadId: await findThread(id, m.order?.name ?? null, email) };
    }),
  );
  if (res.length === 1) return res[0];
  const best = Math.max(...res.map((r) => RANK[r.m.confidence]));
  if (best > 0) {
    const top = res.filter((r) => RANK[r.m.confidence] === best);
    if (top.length === 1) return top[0];
    const withTicket = top.filter((r) => r.threadId);
    if (withTicket.length === 1) return withTicket[0];
    const keep = top.find((r) => r.shopId === currentShopId) ?? top[0];
    return { ...keep, m: { order: null, confidence: "keine", note: "Passt zu Bestellungen in mehreren Shops — bitte prüfen" } };
  }
  const withTicket = res.filter((r) => r.threadId);
  if (withTicket.length === 1) {
    return { ...withTicket[0], m: { ...withTicket[0].m, note: `${withTicket[0].m.note} · Shop über Kunden-Ticket bestimmt` } };
  }
  const keep = res.find((r) => r.shopId === currentShopId) ?? res[0];
  return { ...keep, m: { ...keep.m, note: `${keep.m.note} · Shop unklar (gemeinsames PayPal-Konto) — bitte prüfen` } };
}

/**
 * PayPal-Fälle der letzten ~170 Tage für das PayPal-Konto dieses Shops holen und speichern.
 * Teilen sich mehrere Shops ein Konto, wird einmal abgerufen und jeder Fall genau EINEM Shop zugeordnet.
 */
export async function syncPaypalDisputes(shopId: string): Promise<{ count: number; forShop: number }> {
  const g = await paypalGroup(shopId);
  if (!g) return { count: 0, forShop: 0 };
  const { creds: c, shopIds } = g;
  const inGroup = inArray(schema.shopPaypal.shopId, shopIds);
  try {
    const { token } = await paypalToken(c);
    const since = new Date(Date.now() - 170 * 86_400_000).toISOString();
    const list = await listPaypalDisputes(c, token, since);
    let forShop = 0;
    for (const s of list) {
      const existing = await db
        .select({ id: schema.disputeCase.id, shopId: schema.disputeCase.shopId, raw: schema.disputeCase.raw, conf: schema.disputeCase.matchConfidence, evidence: schema.disputeCase.evidence })
        .from(schema.disputeCase)
        .where(and(eq(schema.disputeCase.source, "paypal"), eq(schema.disputeCase.providerCaseId, s.dispute_id), inArray(schema.disputeCase.shopId, shopIds)))
        .limit(1)
        .then((r) => r[0] ?? null);
      // Unverändert seit dem letzten Abruf und sicher zugeordnet -> nichts zu tun (spart PayPal- + Shopify-Aufrufe)
      // (offene Fälle trotzdem neu abgleichen, damit der Zustellstatus aktuell bleibt)
      const open = ["OPEN", "WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE", "UNDER_REVIEW"].includes(s.status);
      if (existing && existing.raw?.update_time === s.update_time && existing.conf === "sicher" && !open) {
        if (existing.shopId === shopId) forShop++;
        continue;
      }
      const d = await getPaypalDispute(c, token, s.dispute_id);
      const tx = d.transactions[0];
      const { status, outcome } = mapStatus(d);
      // Manuell verschobene Fälle bleiben im gewählten Shop (nur dort neu abgleichen)
      const manual = existing?.evidence?.manualShop === "1";
      const pick = manual
        ? await (async () => {
            const mm = await matchOrder(existing!.shopId, d);
            return { shopId: existing!.shopId, m: { ...mm, note: `${mm.note} · Shop manuell gewählt` }, threadId: await findThread(existing!.shopId, mm.order?.name ?? null, d.transactions[0]?.buyerEmail ?? null) };
          })()
        : await pickShop(shopIds, d, existing?.shopId ?? null);
      // Nie eine bessere alte Zuordnung durch eine schwächere ersetzen
      const target =
        existing && pick.shopId !== existing.shopId && pick.m.confidence === "keine" ? existing.shopId : pick.shopId;
      const m = target === pick.shopId ? pick.m : await matchOrder(target, d);
      const threadId = target === pick.shopId ? pick.threadId : await findThread(target, m.order?.name ?? null, tx?.buyerEmail ?? null);
      if (target === shopId) forShop++;
      const vals = {
        shopId: target,
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
        facts: m.order ? factsFromOrder(m.order) : null,
        raw: d.raw,
        updatedAt: new Date(),
      };
      // Bestehenden Fall aktualisieren (auch Shop-Wechsel) — Entwurf, Entscheidung und Audit bleiben erhalten
      if (existing) await db.update(schema.disputeCase).set(vals).where(eq(schema.disputeCase.id, existing.id));
      else await db.insert(schema.disputeCase).values({ source: "paypal", providerCaseId: d.dispute_id, ...vals });
    }
    await db.update(schema.shopPaypal).set({ lastSyncAt: new Date(), lastError: null }).where(inGroup);
    return { count: list.length, forShop };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Auch bei Fehler den Zeitpunkt merken -> kein Dauer-Anklopfen bei falschen Zugangsdaten (nächster Versuch in 30 Min.)
    await db.update(schema.shopPaypal).set({ lastError: msg.slice(0, 300), lastSyncAt: new Date() }).where(inGroup);
    throw e;
  }
}

/** Worker: jedes PayPal-Konto höchstens alle 30 Minuten (gemeinsame Konten nur einmal). */
export async function syncAllPaypal(): Promise<number> {
  const rows = await db
    .select({ shopId: schema.shopPaypal.shopId, clientId: schema.shopPaypal.clientId, mode: schema.shopPaypal.mode, last: schema.shopPaypal.lastSyncAt })
    .from(schema.shopPaypal);
  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    const key = `${r.mode}:${r.clientId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.last && Date.now() - r.last.getTime() < 30 * 60_000) continue;
    try {
      n += (await syncPaypalDisputes(r.shopId)).count;
    } catch (e) {
      console.error(`[paypal] ${r.shopId}:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

/** Einen Fall frisch von PayPal holen und Status/Verlauf/Frist aktualisieren (nach einer Aktion). */
export async function refreshPaypalCase(caseId: string): Promise<PaypalDisputeDetail | null> {
  const row = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!row || row.source !== "paypal") return null;
  const c = await loadPaypalCreds(row.shopId);
  if (!c) return null;
  const { token } = await paypalToken(c);
  const d = await getPaypalDispute(c, token, row.providerCaseId);
  const { status, outcome } = mapStatus(d);
  await db
    .update(schema.disputeCase)
    .set({
      status,
      outcome,
      type: d.dispute_life_cycle_stage ?? row.type,
      dueBy: d.seller_response_due_date ? new Date(d.seller_response_due_date) : null,
      raw: d.raw,
      updatedAt: new Date(),
    })
    .where(eq(schema.disputeCase.id, caseId));
  return d;
}
