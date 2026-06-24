// COGS-Raten je Brand laden (Default, falls nicht gesetzt) + Plausi-Helfer.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { COGS_RATE_DEFAULTS, COGS_RATE_DEFS, type CogsRates } from "@/lib/finance/cogs";

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
