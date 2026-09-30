// COGS-Raten je Brand laden (Default, falls nicht gesetzt) + Plausi-Helfer.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import {
  COGS_RATE_DEFAULTS,
  COGS_RATE_DEFS,
  categorizeLineItem,
  cogsFromProductTable,
  isZeroCostUpsell,
  productKey,
  usesRuleEngine,
  type CogsRates,
} from "@/lib/finance/cogs";

export type CogsRateRow = {
  key: keyof CogsRates;
  label: string;
  hint: string;
  unitCents: number;
  isDefault: boolean;
  updatedAt: Date | null;
};

/** Reine Raten-Map für die COGS-Engine (Default, wo nichts gespeichert ist). */
export async function getCogsRates(shopId: string): Promise<CogsRates> {
  const rows = await db.select().from(schema.financeCogsRate).where(eq(schema.financeCogsRate.shopId, shopId));
  const m: Record<string, number> = {};
  for (const r of rows) m[r.key] = r.unitCents;
  return {
    sonic_pulse_bundle: m.sonic_pulse_bundle ?? COGS_RATE_DEFAULTS.sonic_pulse_bundle,
    m_shield: m.m_shield ?? COGS_RATE_DEFAULTS.m_shield,
    protect_plus: m.protect_plus ?? COGS_RATE_DEFAULTS.protect_plus,
    gartenhandschuhe: m.gartenhandschuhe ?? COGS_RATE_DEFAULTS.gartenhandschuhe,
  };
}

/** Raten + Anzeige-Meta für die UI (Default-Markierung + Stand). */
export async function getCogsRateRows(shopId: string): Promise<CogsRateRow[]> {
  const rows = await db.select().from(schema.financeCogsRate).where(eq(schema.financeCogsRate.shopId, shopId));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return COGS_RATE_DEFS.map((def) => {
    const stored = byKey.get(def.key);
    return {
      key: def.key,
      label: def.label,
      hint: def.hint,
      unitCents: stored ? stored.unitCents : COGS_RATE_DEFAULTS[def.key],
      isDefault: !stored,
      updatedAt: stored?.updatedAt ?? null,
    };
  });
}

/** „Was wurde laut Shopify in dieser Woche bestellt" — je Produkt: Menge + berechnete COGS.
 *  Soll-Seite für den späteren Supplier-Rechnungs-Abgleich. */
export async function getProductBreakdown(
  shopId: string,
  weekStart: string,
): Promise<{ label: string; units: number; cogsCents: number }[]> {
  const items = await db
    .select({
      title: schema.financeOrderItem.title,
      quantity: schema.financeOrderItem.quantity,
      lineCogsCents: schema.financeOrderItem.lineCogsCents,
    })
    .from(schema.financeOrderItem)
    .innerJoin(schema.financeOrder, eq(schema.financeOrderItem.orderId, schema.financeOrder.id))
    .where(and(eq(schema.financeOrderItem.shopId, shopId), eq(schema.financeOrder.weekStart, weekStart)));

  const rules = await shopUsesRules(shopId);
  const map = new Map<string, { units: number; cogsCents: number }>();
  for (const it of items) {
    // Regel-Shop: Kategorien (Repello). Sonst: je Produkttitel.
    const cat = rules ? categorizeLineItem(it.title) : it.title;
    const e = map.get(cat) ?? { units: 0, cogsCents: 0 };
    e.units += it.quantity;
    e.cogsCents += it.lineCogsCents;
    map.set(cat, e);
  }
  return [...map.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.cogsCents - a.cogsCents);
}

/** Plausi-Check: Produkte aus echten Bestellungen, die KEIN COGS-Mapping haben. */
export async function getUnmappedTitles(shopId: string): Promise<{ title: string; count: number }[]> {
  return db
    .select({ title: schema.financeOrderItem.title, count: sql<number>`count(*)::int` })
    .from(schema.financeOrderItem)
    .where(and(eq(schema.financeOrderItem.shopId, shopId), eq(schema.financeOrderItem.mapped, false)))
    .groupBy(schema.financeOrderItem.title)
    .orderBy(sql`count(*) desc`)
    .limit(30);
}

/** Rechnet dieser Shop mit der festen Regel-Engine (Repello) oder mit der Produkt-Kostentabelle? */
export async function shopUsesRules(shopId: string): Promise<boolean> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId), columns: { slug: true } });
  return usesRuleEngine(shop?.slug);
}

/** Einkaufspreise je Produkt (productKey -> Cent). */
export async function getProductCostMap(shopId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(schema.financeProductCost).where(eq(schema.financeProductCost.shopId, shopId));
  return new Map(rows.map((r) => [r.productKey, r.unitCents]));
}

export type ProductCostRow = {
  key: string;
  label: string;
  units: number; // verkaufte Stück (alle eingelesenen Bestellungen)
  unitCents: number | null; // null = noch kein Preis
  source: string | null;
  updatedAtISO: string | null;
};

/** Alle Produkte aus echten Bestellungen + hinterlegte Preise (für die Pflege-Maske). */
export async function getProductCostRows(shopId: string): Promise<ProductCostRow[]> {
  const sold = await db
    .select({ title: schema.financeOrderItem.title, units: sql<number>`sum(${schema.financeOrderItem.quantity})::int` })
    .from(schema.financeOrderItem)
    .where(eq(schema.financeOrderItem.shopId, shopId))
    .groupBy(schema.financeOrderItem.title);
  const costs = await db.select().from(schema.financeProductCost).where(eq(schema.financeProductCost.shopId, shopId));
  const byKey = new Map<string, ProductCostRow>();
  for (const r of sold) {
    const k = productKey(r.title);
    const e = byKey.get(k) ?? { key: k, label: r.title, units: 0, unitCents: null, source: null, updatedAtISO: null };
    e.units += r.units;
    byKey.set(k, e);
  }
  for (const c of costs) {
    const e = byKey.get(c.productKey) ?? { key: c.productKey, label: c.label, units: 0, unitCents: null, source: null, updatedAtISO: null };
    e.unitCents = c.unitCents;
    e.source = c.source;
    e.updatedAtISO = c.updatedAt.toISOString();
    byKey.set(c.productKey, e);
  }
  // Upsells (Paketschutz, Bestellung vorziehen …) haben keinen Wareneinsatz — nicht als „fehlt“ zeigen.
  for (const e of byKey.values()) {
    if (e.unitCents == null && isZeroCostUpsell(e.label)) {
      e.unitCents = 0;
      e.source = "upsell";
    }
  }
  // Ohne Preis zuerst (das ist die Arbeit), dann nach Stückzahl.
  return [...byKey.values()].sort((a, b) => (a.unitCents == null ? 0 : 1) - (b.unitCents == null ? 0 : 1) || b.units - a.units);
}

/** Nach Preisänderung: COGS aller eingelesenen Bestellungen des Shops neu rechnen (nur Produkt-Tabellen-Shops). */
export async function recomputeProductCogs(shopId: string): Promise<{ orders: number }> {
  const costs = await getProductCostMap(shopId);
  const items = await db
    .select({
      id: schema.financeOrderItem.id,
      orderId: schema.financeOrderItem.orderId,
      title: schema.financeOrderItem.title,
      quantity: schema.financeOrderItem.quantity,
    })
    .from(schema.financeOrderItem)
    .where(eq(schema.financeOrderItem.shopId, shopId));
  const perOrder = new Map<string, { cogs: number; unknown: boolean }>();
  for (const it of items) {
    const c = cogsFromProductTable(it.title, it.quantity, costs);
    await db
      .update(schema.financeOrderItem)
      .set({ unitCogsCents: c.unitCents, lineCogsCents: c.lineCents, mapped: c.mapped })
      .where(eq(schema.financeOrderItem.id, it.id));
    const o = perOrder.get(it.orderId) ?? { cogs: 0, unknown: false };
    o.cogs += c.lineCents;
    if (!c.mapped) o.unknown = true;
    perOrder.set(it.orderId, o);
  }
  for (const [orderId, o] of perOrder) {
    await db
      .update(schema.financeOrder)
      .set({ cogsCents: o.cogs, cogsUnknown: o.unknown })
      .where(and(eq(schema.financeOrder.id, orderId), eq(schema.financeOrder.shopId, shopId)));
  }
  return { orders: perOrder.size };
}
