// Reklamations-Auswertung: Liste + Monatssummen + Defekte je Produkt + Status.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export { CLAIM_STATUSES, CLAIM_STATUS_LABEL, type ClaimStatus } from "@/lib/claims";

export type ClaimRow = typeof schema.supplierClaim.$inferSelect;

export type ClaimsOverview = {
  claims: ClaimRow[];
  byProduct: { product: string; claims: number; units: number; creditCents: number }[];
  byStatus: Record<string, number>;
  month: { label: string; claims: number; units: number; creditCents: number; openUnits: number };
};

function monthKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit" }).format(d);
}

export async function getClaimsOverview(shopId: string, now = new Date()): Promise<ClaimsOverview> {
  const claims = await db
    .select()
    .from(schema.supplierClaim)
    .where(eq(schema.supplierClaim.shopId, shopId))
    .orderBy(desc(schema.supplierClaim.createdAt));

  const byProductMap = new Map<string, { claims: number; units: number; creditCents: number }>();
  const byStatus: Record<string, number> = {};
  const curMonth = monthKey(now);
  let mClaims = 0, mUnits = 0, mCredit = 0, mOpenUnits = 0;

  for (const c of claims) {
    const p = byProductMap.get(c.productLabel) ?? { claims: 0, units: 0, creditCents: 0 };
    p.claims += 1;
    p.units += c.quantity;
    p.creditCents += c.creditCents;
    byProductMap.set(c.productLabel, p);
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

    if (monthKey(new Date(c.createdAt)) === curMonth) {
      mClaims += 1;
      mUnits += c.quantity;
      mCredit += c.creditCents;
      if (c.status === "offen" || c.status === "gesendet") mOpenUnits += c.quantity;
    }
  }

  const byProduct = [...byProductMap.entries()]
    .map(([product, v]) => ({ product, ...v }))
    .sort((a, b) => b.units - a.units);

  const monthLabel = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Vienna", month: "long", year: "numeric" }).format(now);
  return {
    claims,
    byProduct,
    byStatus,
    month: { label: monthLabel, claims: mClaims, units: mUnits, creditCents: mCredit, openUnits: mOpenUnits },
  };
}
