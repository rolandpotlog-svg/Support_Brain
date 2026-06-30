"use server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireFinance } from "@/server/access";
import { ingestShopifyOrders, ingestRefunds } from "@/server/finance/ingest";
import { extractPdfText } from "@/server/finance/pickoship-pdf";
import { parsePickoshipText, type PickoshipOrder, type PickoshipResult } from "@/lib/finance/pickoship";
import { parseBlueprint } from "@/server/finance/blueprint";
import { getCogsRates } from "@/server/finance/cogs-rates";
import { buildAssistantContext } from "@/server/finance/assistant-context";
import { complete, type ChatMessage } from "@/server/ai";
import { saveAdsAccount, ingestMetaSpend } from "@/server/finance/meta-ads";
import { saveGoogleAds as saveGoogleAdsCfg, ingestGoogleSpend, type GoogleAdsInput } from "@/server/finance/google-ads";
import { COGS_RATE_DEFS } from "@/lib/finance/cogs";

const euros = (n: unknown) => Math.round((Number(n) || 0) * 100);

/** Bestellungen eines Brands aus Shopify ziehen (Datumsbereich, inkl.). */
export async function ingestFinance(
  shopId: string,
  sinceDate: string,
  untilDate: string,
): Promise<{ count: number; unmapped: number }> {
  await requireFinance(shopId);
  const r = await ingestShopifyOrders(shopId, sinceDate, untilDate);
  await ingestRefunds(shopId, sinceDate, untilDate).catch(() => {}); // Refunds nach Erstattungs-Datum
  return r;
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
    // Alle Wochen aus der Excel übernehmen (Umsatz, COGS, Versand) — die Excel ist
    // der validierte Wochen-Datensatz. Shopify-Live greift für Wochen ohne Excel.
    if (w.hasRevenue) {
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

/** Basis-Stückkosten (COGS) speichern. Wirkt auf neue/laufende Wochen (Excel-Wochen bleiben). */
export async function saveCogsRates(shopId: string, valuesEuros: Record<string, number>) {
  await requireFinance(shopId);
  for (const def of COGS_RATE_DEFS) {
    if (!(def.key in valuesEuros)) continue;
    const unitCents = euros(valuesEuros[def.key]);
    await db
      .insert(schema.financeCogsRate)
      .values({ shopId, key: def.key, unitCents })
      .onConflictDoUpdate({
        target: [schema.financeCogsRate.shopId, schema.financeCogsRate.key],
        set: { unitCents, updatedAt: new Date() },
      });
  }
  revalidatePath("/finance");
}

/** Finance-Assistent: beantwortet Fragen NUR aus den echten Engine-Daten (Grounding). */
export async function askFinanceAssistant(shopId: string, history: ChatMessage[]): Promise<string> {
  await requireFinance(shopId);
  if (history.length === 0) throw new Error("Keine Frage");
  const context = await buildAssistantContext(shopId);
  const system =
    "Du bist der Finance-Analyst dieses Shops. Du beantwortest Fragen AUSSCHLIESSLICH auf Basis der unten gelieferten FINANZDATEN.\n" +
    "REGELN (strikt):\n" +
    "1. Erfinde NIEMALS Zahlen. Verwende nur Werte, die in den FINANZDATEN stehen.\n" +
    "2. Wenn die Daten die Frage nicht beantworten, sage klar, dass du dazu keine Daten hast, und nenne, welche Daten fehlen würden. Rate NICHT.\n" +
    "3. Zerlege deine Antwort nachvollziehbar: zeige die relevanten Zahlen und die Rechnung Schritt für Schritt.\n" +
    "4. Rechne nur mit den gegebenen Zahlen. Wenn du eine Differenz erklärst, zeige beide Werte und die Differenz.\n" +
    "5. Antworte auf Deutsch, präzise und kompakt. Euro mit € und 2 Nachkommastellen.\n" +
    "6. Du bist read-only — du erklärst nur, du änderst nichts. Keine Erfindungen, keine externen Annahmen.\n\n" +
    "Hinweise zur Bedeutung: COGS = Produktkosten (Menge×Stückkost). 'OhneVersand' = Bestellungen ohne erfasste Versandkosten (Versand dann unvollständig). " +
    "'UnbekProd' = Bestellungen mit Produkt ohne Stückkost-Mapping (COGS evtl. zu niedrig). 'läuft' = laufende Woche (vorläufig). " +
    "Marketing-Kanäle ohne Spend können fehlen (z. B. Google noch nicht verbunden).\n\n" +
    "=== FINANZDATEN ===\n" +
    context;
  return complete({ system, messages: history.slice(-12), maxTokens: 1600, effort: "medium" });
}

/** Cockpit-Sync: Shopify + verbundene Ad-Konten für einen Zeitraum frisch ziehen. */
export async function syncCockpit(shopId: string, since: string, until: string): Promise<{ shopifyCount: number; metaCents: number; googleCents: number }> {
  await requireFinance(shopId);
  const sh = await ingestShopifyOrders(shopId, since, until);
  await ingestRefunds(shopId, since, until).catch(() => {});
  let metaCents = 0;
  let googleCents = 0;
  const metaAccs = await db.select().from(schema.financeAdsAccount).where(eq(schema.financeAdsAccount.shopId, shopId));
  for (const a of metaAccs) {
    try { metaCents += (await ingestMetaSpend(shopId, a.channel, since, until)).totalCents; } catch { /* Konto evtl. nicht erreichbar -> Teil-Sync */ }
  }
  const g = await db.query.financeGoogleAds.findFirst({ where: eq(schema.financeGoogleAds.shopId, shopId) });
  if (g) {
    try { googleCents = (await ingestGoogleSpend(shopId, since, until)).totalCents; } catch { /* z.B. Basic-Access fehlt */ }
  }
  revalidatePath("/finance/cockpit");
  revalidatePath("/finance");
  return { shopifyCount: sh.count, metaCents, googleCents };
}

export type CogsRateCheck = { priceCents: number; qty: number; known: boolean };
/** Meta-Ads-Verbindung speichern (Token validieren + verschlüsseln). */
export async function saveMetaAds(shopId: string, channel: string, accountId: string, token: string): Promise<{ name?: string }> {
  await requireFinance(shopId);
  const r = await saveAdsAccount(shopId, channel, accountId, token);
  revalidatePath("/finance");
  return r;
}

/** Werbeausgaben aus Meta ziehen (Zeitraum) -> Marketing je Woche. */
export async function pullMetaSpend(shopId: string, channel: string, since: string, until: string): Promise<{ weeks: number; totalCents: number }> {
  await requireFinance(shopId);
  const r = await ingestMetaSpend(shopId, channel, since, until);
  revalidatePath("/finance");
  return r;
}

/** Google-Ads-Verbindung speichern (validieren + verschlüsseln). */
export async function saveGoogleAds(shopId: string, input: GoogleAdsInput): Promise<void> {
  await requireFinance(shopId);
  await saveGoogleAdsCfg(shopId, input);
  revalidatePath("/finance");
}

/** Werbekosten aus Google Ads ziehen (Zeitraum) -> Marketing je Woche. */
export async function pullGoogleSpend(shopId: string, since: string, until: string): Promise<{ weeks: number; totalCents: number }> {
  await requireFinance(shopId);
  const r = await ingestGoogleSpend(shopId, since, until);
  revalidatePath("/finance");
  return r;
}

export type PickoshipReview = PickoshipResult & {
  knownCount: number;
  unknownNames: string[];
  ourCogsCents: number; // Engine-COGS der bekannten Orders
  cogsMatches: boolean; // Rechnung-Produktkosten ≈ Engine-COGS (±1 %)
  rateChecks: CogsRateCheck[]; // Stückpreise im PDF vs. hinterlegte Stückkosten
  shopifyInRangeCount: number; // Shopify-Bestellungen im Beleg-Zeitraum
  missingFromInvoice: string[]; // in Shopify, aber NICHT im Beleg (nicht versendet/abgerechnet?)
  cogsOrderMismatches: CogsOrderMismatch[]; // Order für Order: Rechnung vs. Engine weicht ab
};
export type CogsOrderMismatch = { orderName: string; invoiceCents: number; shopifyCents: number };

/** Pickoship-PDF parsen (NICHT verbuchen) -> Kontroll-Ansicht: Versand + COGS gegen Rechnung & Shopify. */
export async function parsePickoshipUpload(formData: FormData): Promise<PickoshipReview> {
  const shopId = String(formData.get("shopId") ?? "");
  await requireFinance(shopId);
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("Keine Datei");
  const text = await extractPdfText(Buffer.from(await file.arrayBuffer()));
  const result = parsePickoshipText(text);
  if (result.orders.length === 0) throw new Error("Keine Bestellungen im PDF erkannt — ist es ein Pickoship-Beleg?");

  // Abgleich mit Shopify-Bestellungen dieses Brands (Kontrolle) + Engine-COGS.
  const names = result.orders.map((o) => o.orderName);
  const known = await db
    .select({ orderName: schema.financeOrder.orderName, cogsCents: schema.financeOrder.cogsCents })
    .from(schema.financeOrder)
    .where(and(eq(schema.financeOrder.shopId, shopId), inArray(schema.financeOrder.orderName, names)));
  const knownSet = new Set(known.map((k) => k.orderName));
  const ourCogsCents = known.reduce((s, k) => s + k.cogsCents, 0);
  const ref = result.invoiceProductTotalCents ?? result.productTotalCents;
  const cogsMatches = ref > 0 && Math.abs(result.productTotalCents - ourCogsCents) <= Math.max(100, ref * 0.01);

  // Stückpreis-Kontrolle: jeder Preis im PDF muss einer hinterlegten Stückkost entsprechen.
  const rates = await getCogsRates(shopId);
  const rateValues = new Set<number>(Object.values(rates));
  const rateChecks: CogsRateCheck[] = result.unitPrices.map((u) => ({
    priceCents: u.price,
    qty: u.qty,
    known: rateValues.has(u.price),
  }));

  // Abgleich pro Order: Rechnung-Produktkosten vs. Engine-COGS je Bestellung.
  const shopCogsByName = new Map(known.map((k) => [k.orderName, k.cogsCents]));
  const cogsOrderMismatches: CogsOrderMismatch[] = result.orders
    .filter((o) => shopCogsByName.has(o.orderName))
    .map((o) => ({ orderName: o.orderName, invoiceCents: o.productCents, shopifyCents: shopCogsByName.get(o.orderName)! }))
    .filter((d) => Math.abs(d.invoiceCents - d.shopifyCents) > 1)
    .sort((a, b) => Math.abs(b.invoiceCents - b.shopifyCents) - Math.abs(a.invoiceCents - a.shopifyCents))
    .slice(0, 20);

  // Abdeckung: Shopify-Bestellungen im Beleg-Zeitraum, die NICHT auf der Rechnung stehen.
  let shopifyInRangeCount = 0;
  let missingFromInvoice: string[] = [];
  if (result.dateSince && result.dateUntil) {
    const inRange = await db
      .select({ orderName: schema.financeOrder.orderName })
      .from(schema.financeOrder)
      .where(and(
        eq(schema.financeOrder.shopId, shopId),
        sql`${schema.financeOrder.createdAt}::date >= ${result.dateSince}`,
        sql`${schema.financeOrder.createdAt}::date <= ${result.dateUntil}`,
      ));
    shopifyInRangeCount = inRange.length;
    const invSet = new Set(names);
    missingFromInvoice = inRange.map((o) => o.orderName).filter((n) => !invSet.has(n)).slice(0, 20);
  }

  return {
    ...result,
    knownCount: knownSet.size,
    unknownNames: names.filter((n) => !knownSet.has(n)).slice(0, 20),
    ourCogsCents,
    cogsMatches,
    rateChecks,
    shopifyInRangeCount,
    missingFromInvoice,
    cogsOrderMismatches,
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
