"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireFinance } from "@/server/access";
import { ingestShopifyOrders } from "@/server/finance/ingest";
import { extractPdfText } from "@/server/finance/pickoship-pdf";
import { parsePickoshipText, type PickoshipOrder, type PickoshipResult } from "@/lib/finance/pickoship";

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
