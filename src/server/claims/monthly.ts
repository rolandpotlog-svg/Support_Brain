// Monats-Defekt-Report: je Produkt defekte Stück eines Monats + angefragte/erhaltene
// Gutschrift (defekte Stück × Stückkost). Grundlage für die Gutschrift-Anfrage an den Supplier.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getCogsRates } from "@/server/finance/cogs-rates";
import type { CogsRates } from "@/lib/finance/cogs";

const LABEL_TO_RATE: Record<string, keyof CogsRates> = {
  "Sonic Pulse Pro": "sonic_pulse_bundle",
  "M-Shield": "m_shield",
  "Protect+ / Juckreiz": "protect_plus",
  Gartenhandschuhe: "gartenhandschuhe",
};

export type MonthlyDefectRow = {
  product: string;
  claims: number;
  units: number;
  unitCostCents: number; // 0 = unbekannt (kein Mapping)
  requestedCents: number; // units × Stückkost
  receivedCents: number; // tatsächlich erhaltene Gutschrift
};

export type MonthlyDefectReport = {
  month: string; // YYYY-MM
  label: string; // "Juni 2026"
  rows: MonthlyDefectRow[];
  totals: { claims: number; units: number; requestedCents: number; receivedCents: number };
  availableMonths: { key: string; label: string }[];
};

const viennaMonth = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit" }).format(d);

const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
};

export async function getMonthlyDefectReport(
  shopId: string,
  month?: string,
  now = new Date(),
): Promise<MonthlyDefectReport> {
  const claims = await db.select().from(schema.supplierClaim).where(eq(schema.supplierClaim.shopId, shopId));
  const rates = await getCogsRates(shopId);
  const curMonth = viennaMonth(now);

  const monthsSet = new Set<string>(claims.map((c) => viennaMonth(new Date(c.createdAt))));
  monthsSet.add(curMonth);
  const availableMonths = [...monthsSet].sort().reverse().map((key) => ({ key, label: monthLabel(key) }));

  const target = month && monthsSet.has(month) ? month : curMonth;
  const monthClaims = claims.filter((c) => viennaMonth(new Date(c.createdAt)) === target);

  const byProduct = new Map<string, { claims: number; units: number; receivedCents: number }>();
  for (const c of monthClaims) {
    const e = byProduct.get(c.productLabel) ?? { claims: 0, units: 0, receivedCents: 0 };
    e.claims += 1;
    e.units += c.quantity;
    e.receivedCents += c.creditCents;
    byProduct.set(c.productLabel, e);
  }

  const rows: MonthlyDefectRow[] = [...byProduct.entries()]
    .map(([product, v]) => {
      const rateKey = LABEL_TO_RATE[product];
      const unitCostCents = rateKey ? rates[rateKey] : 0;
      return {
        product,
        claims: v.claims,
        units: v.units,
        unitCostCents,
        requestedCents: v.units * unitCostCents,
        receivedCents: v.receivedCents,
      };
    })
    .sort((a, b) => b.requestedCents - a.requestedCents);

  const totals = rows.reduce(
    (t, r) => ({
      claims: t.claims + r.claims,
      units: t.units + r.units,
      requestedCents: t.requestedCents + r.requestedCents,
      receivedCents: t.receivedCents + r.receivedCents,
    }),
    { claims: 0, units: 0, requestedCents: 0, receivedCents: 0 },
  );

  return { month: target, label: monthLabel(target), rows, totals, availableMonths };
}
