"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireFinance } from "@/server/access";
import { ingestShopifyOrders } from "@/server/finance/ingest";
import { extractPdfText } from "@/server/finance/pickoship-pdf";
import { parsePickoshipText, type PickoshipOrder, type PickoshipResult } from "@/lib/finance/pickoship";
import { parseBlueprint } from "@/server/finance/blueprint";

const euros = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Bestellungen eines Brands aus Shopify ziehen (Datumsbereich, inkl.). */
export async function ingestFinance(
  shopId: string,
  sinceDate: string,
  untilDate: string,
): Promise<{ count: number; unmapped: number }> {
  await requireFinance(shopId);
  return ingestShopifyOrders(shopId, sinceDate, untilDate);
}

export async function saveMarketing(shopId: string, weekStart: string, channel: string, amountEuros: number) {
  await requireFinance(shopId);
  const amountCents = euros(amountEuros);
  await db
    .insert(schema.financeMarketing)
    .values({ shopId, weekStart, channel, amountCents })
    .onConflictDoUpdate({
      target: [schema.financeMarketing.shopId, schema.financeMarketing.weekStart, schema.financeMarketing.channel],
      set: { amountCents, updatedAt: new Date() },
    });
  revalidatePath("/finance");
}

export async function saveCostOverride(shopId: string, weekStart: string, fixEuros: number, varEuros: number) {
  await requireFinance(shopId);
  const fixkostenCents = euros(fixEuros);
  const variableCents = euros(varEuros);
  await db
    .insert(schema.financeCostOverride)
    .values({ shopId, weekStart, fixkostenCents, variableCents })
    .onConflictDoUpdate({
      target: [schema.financeCostOverride.shopId, schema.financeCostOverride.weekStart],
      set: { fixkostenCents, variableCents, updatedAt: new Date() },
    });
  revalidatePath("/finance");
}

/** Alle manuellen Wochen-Eingaben auf einmal: Marketing je Kanal + Fix/Variable. */
export async function saveWeekInputs(
  shopId: string,
  weekStart: string,
  marketingEuros: Record<string, number>,
  fixEuros: number,
  varEuros: number,
) {
  await requireFinance(shopId);
  for (const [channel, val] of Object.entries(marketingEuros)) {
    const amountCents = euros(val);
    await db
      .insert(schema.financeMarketing)
      .values({ shopId, weekStart, channel, amountCents })
      .onConflictDoUpdate({
        target: [schema.financeMarketing.shopId, schema.financeMarketing.weekStart, schema.financeMarketing.channel],
        set: { amountCents, updatedAt: new Date() },
      });
  }
  await db
    .insert(schema.financeCostOverride)
    .values({ shopId, weekStart, fixkostenCents: euros(fixEuros), variableCents: euros(varEuros) })
    .onConflictDoUpdate({
      target: [schema.financeCostOverride.shopId, schema.financeCostOverride.weekStart],
      set: { fixkostenCents: euros(fixEuros), variableCents: euros(varEuros), updatedAt: new Date() },
    });
  revalidatePath("/finance");
}

/** PnL-Blueprint-Excel importieren: Marketing (alle Wochen) + historische Wochen-Aggregate. */
export async function importBlueprint(
  formData: FormData,
): Promise<{ marketingWeeks: number; manualWeeks: number; sheet: string }> {
  const shopId = String(formData.get("shopId") ?? "");
  await requireFinance(shopId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Keine Datei");
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  if (!shop) throw new Error("Brand nicht gefunden");

  const weeks = parseBlueprint(Buffer.from(await file.arrayBuffer()), shop.name);
  if (weeks.length === 0) throw new Error(`Keine KW-Zeilen im Blatt „${shop.name}" gefunden.`);

  let marketingWeeks = 0;
  let manualWeeks = 0;
  for (const w of weeks) {
    const mkTotal = Object.values(w.marketing).reduce((a, b) => a + b, 0);
    if (mkTotal > 0) {
      for (const [channel, amountCents] of Object.entries(w.marketing)) {
        await db
          .insert(schema.financeMarketing)
          .values({ shopId, weekStart: w.weekStart, channel, amountCents })
          .onConflictDoUpdate({
            target: [schema.financeMarketing.shopId, schema.financeMarketing.weekStart, schema.financeMarketing.channel],
            set: { amountCents, updatedAt: new Date() },
          });
      }
      marketingWeeks++;
    }
    // Historische Wochen nur übernehmen, wenn Shopify diese Woche NICHT (vollständig) hat.
    const excelNetto = w.umsatzBruttoCents - w.ustCents - w.rabatteCents - w.refundsCents;
    const sh = await db
      .select({ netto: sql<number>`coalesce(sum(umsatz_brutto_cents - ust_cents - rabatte_cents - refunds_cents),0)::int` })
      .from(schema.financeOrder)
      .where(and(eq(schema.financeOrder.shopId, shopId), eq(schema.financeOrder.weekStart, w.weekStart)));
    const shopifyIncomplete = (sh[0]?.netto ?? 0) < excelNetto * 0.8;

    if (w.hasRevenue && shopifyIncomplete) {
      const vals = {
        umsatzBruttoCents: w.umsatzBruttoCents,
        rabatteCents: w.rabatteCents,
        refundsCents: w.refundsCents,
        versandEinnahmeCents: w.versandEinnahmeCents,
        ustCents: w.ustCents,
        cogsCents: w.cogsCents,
        versandkostenCents: w.versandkostenCents,
        updatedAt: new Date(),
      };
      await db
        .insert(schema.financeWeekManual)
        .values({ shopId, weekStart: w.weekStart, ...vals })
        .onConflictDoUpdate({ target: [schema.financeWeekManual.shopId, schema.financeWeekManual.weekStart], set: vals });
      manualWeeks++;
    }
  }
  revalidatePath("/finance");
  return { marketingWeeks, manualWeeks, sheet: shop.name };
}

export type PickoshipReview = PickoshipResult & { knownCount: number; unknownNames: string[] };

/** Pickoship-PDF parsen (NICHT verbuchen) -> Kontroll-Ansicht: Summe vs. Rechnung + Shopify-Abgleich. */
export async function parsePickoshipUpload(formData: FormData): Promise<PickoshipReview> {
  const shopId = String(formData.get("shopId") ?? "");
  await requireFinance(shopId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Keine Datei");
  const text = await extractPdfText(Buffer.from(await file.arrayBuffer()));
  const result = parsePickoshipText(text);
  if (result.orders.length === 0) throw new Error("Keine Bestellungen im PDF erkannt — ist es ein Pickoship-Beleg?");

  // Abgleich mit Shopify-Bestellungen dieses Brands (Kontrolle).
  const names = result.orders.map((o) => o.orderName);
  const known = await db
    .select({ orderName: schema.financeOrder.orderName })
    .from(schema.financeOrder)
    .where(and(eq(schema.financeOrder.shopId, shopId), inArray(schema.financeOrder.orderName, names)));
  const knownSet = new Set(known.map((k) => k.orderName));
  return {
    ...result,
    knownCount: knownSet.size,
    unknownNames: names.filter((n) => !knownSet.has(n)).slice(0, 20),
  };
}

/** Geprüfte Versandwerte verbuchen (nach Mensch-Freigabe). */
export async function commitPickoshipShipping(shopId: string, orders: PickoshipOrder[]): Promise<{ count: number }> {
  await requireFinance(shopId);
  for (const o of orders) {
    await db
      .insert(schema.financeShipping)
      .values({ shopId, orderName: o.orderName, shippingCents: o.shippingCents, source: "invoice" })
      .onConflictDoUpdate({
        target: [schema.financeShipping.shopId, schema.financeShipping.orderName],
        set: { shippingCents: o.shippingCents, source: "invoice", updatedAt: new Date() },
      });
  }
  revalidatePath("/finance");
  return { count: orders.length };
}

export async function saveShipping(shopId: string, orderName: string, amountEuros: number) {
  await requireFinance(shopId);
  const shippingCents = euros(amountEuros);
  await db
    .insert(schema.financeShipping)
    .values({ shopId, orderName, shippingCents, source: "manual" })
    .onConflictDoUpdate({
      target: [schema.financeShipping.shopId, schema.financeShipping.orderName],
      set: { shippingCents, source: "manual", updatedAt: new Date() },
    });
  revalidatePath("/finance");
}
