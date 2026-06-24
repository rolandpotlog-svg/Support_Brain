"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireWrite, requireUser, assertShopAccess } from "@/server/access";
import { CLAIM_STATUSES } from "@/server/claims/report";
import { pushClaimToTrello } from "@/server/claims/trello";

const euros = (n: unknown) => Math.round((Number(n) || 0) * 100);

export async function createClaim(input: {
  shopId: string;
  productLabel: string;
  orderName?: string;
  sku?: string;
  quantity: number;
  reason: string;
  source?: "manuell" | "wareneingang";
}) {
  const { user } = await requireWrite(input.shopId, "returns");
  const productLabel = input.productLabel.trim();
  const reason = input.reason.trim();
  if (!productLabel) throw new Error("Artikel fehlt");
  if (!reason) throw new Error("Defekt-Grund fehlt");

  const [row] = await db
    .insert(schema.supplierClaim)
    .values({
      shopId: input.shopId,
      productLabel,
      orderName: input.orderName?.trim() || null,
      sku: input.sku?.trim() || null,
      quantity: Math.max(1, Math.round(Number(input.quantity) || 1)),
      reason,
      source: input.source ?? "manuell",
      createdBy: user.id,
    })
    .returning();

  // Phase 2: sofort als Trello-Karte für den Supplier (no-op, wenn Trello nicht verbunden).
  await pushClaimToTrello(row).catch(() => {});
  revalidatePath("/reklamationen");
  return row;
}

export async function updateClaimStatus(claimId: string, status: string, creditEuros?: number) {
  if (!CLAIM_STATUSES.includes(status as (typeof CLAIM_STATUSES)[number])) throw new Error("Ungültiger Status");
  const user = await requireUser();
  const claim = await db.query.supplierClaim.findFirst({ where: eq(schema.supplierClaim.id, claimId) });
  if (!claim) throw new Error("Reklamation nicht gefunden");
  await assertShopAccess(user, claim.shopId);

  const terminal = status === "gutschrift" || status === "ersetzt" || status === "abgelehnt";
  await db
    .update(schema.supplierClaim)
    .set({
      status,
      ...(creditEuros !== undefined ? { creditCents: euros(creditEuros) } : {}),
      ...(status === "gesendet" && !claim.sentAt ? { sentAt: new Date() } : {}),
      resolvedAt: terminal ? new Date() : null,
    })
    .where(eq(schema.supplierClaim.id, claimId));
  revalidatePath("/reklamationen");
}

export async function deleteClaim(claimId: string) {
  const user = await requireUser();
  const claim = await db.query.supplierClaim.findFirst({ where: eq(schema.supplierClaim.id, claimId) });
  if (!claim) return;
  await assertShopAccess(user, claim.shopId);
  await db.delete(schema.supplierClaim).where(eq(schema.supplierClaim.id, claimId));
  revalidatePath("/reklamationen");
}
