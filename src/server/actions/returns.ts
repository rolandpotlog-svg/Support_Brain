"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap, requireWrite } from "@/server/access";
import { defaultReasons, isRouting } from "@/lib/returns/routing";

export type ReturnSettingsInput = {
  shopId: string;
  enabled: boolean;
  cogsPct: number;
  returnShippingEuros: number;
  resaleableDefault: boolean;
  voucherBonusPct: number;
  firstOfferPct: number;
  fraudWindowDays: number;
  fraudMaxKeepEuros: number;
  highValueThresholdEuros: number;
  accentColor: string;
};

const euros = (n: number) => Math.max(0, Math.round((Number(n) || 0) * 100));
const pct = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

export async function saveReturnSettings(input: ReturnSettingsInput) {
  await requireBrandCap(input.shopId, "settings");
  const vals = {
    enabled: input.enabled,
    cogsPct: pct(input.cogsPct),
    returnShippingCents: euros(input.returnShippingEuros),
    resaleableDefault: input.resaleableDefault,
    voucherBonusPct: Math.max(0, Math.round(Number(input.voucherBonusPct) || 0)),
    firstOfferPct: pct(input.firstOfferPct),
    fraudWindowDays: Math.max(1, Math.round(Number(input.fraudWindowDays) || 60)),
    fraudMaxKeepCents: euros(input.fraudMaxKeepEuros),
    highValueThresholdCents: euros(input.highValueThresholdEuros),
    accentColor: input.accentColor || "#2b6ef2",
    updatedAt: new Date(),
  };
  await db
    .insert(schema.returnSettings)
    .values({ shopId: input.shopId, ...vals })
    .onConflictDoUpdate({ target: schema.returnSettings.shopId, set: vals });

  // Beim ersten Aktivieren Default-Gründe anlegen, falls noch keine existieren.
  if (input.enabled) {
    const existing = await db
      .select({ id: schema.returnReasons.id })
      .from(schema.returnReasons)
      .where(eq(schema.returnReasons.shopId, input.shopId));
    if (existing.length === 0) {
      await db.insert(schema.returnReasons).values(
        defaultReasons().map((r) => ({ shopId: input.shopId, label: r.label, routing: r.routing, sortOrder: r.sortOrder })),
      );
    }
  }
  revalidatePath("/returns/settings");
}

export type ReasonInput = { label: string; routing: string; active: boolean };

export async function saveReasons(shopId: string, reasons: ReasonInput[]) {
  await requireBrandCap(shopId, "settings");
  const clean = reasons
    .filter((r) => r.label.trim() && isRouting(r.routing))
    .map((r, i) => ({ shopId, label: r.label.trim(), routing: r.routing, active: r.active, sortOrder: i }));
  await db.transaction(async (tx) => {
    await tx.delete(schema.returnReasons).where(eq(schema.returnReasons.shopId, shopId));
    if (clean.length) await tx.insert(schema.returnReasons).values(clean);
  });
  revalidatePath("/returns/settings");
}

export async function markReturnTaskDone(taskId: string) {
  const task = await db.query.returnTasks.findFirst({ where: eq(schema.returnTasks.id, taskId) });
  if (!task) throw new Error("Aufgabe nicht gefunden");
  const { user } = await requireWrite(task.shopId, "returns");
  await db
    .update(schema.returnTasks)
    .set({ status: "done", doneBy: user.id, doneAt: new Date() })
    .where(eq(schema.returnTasks.id, taskId));

  // Wenn alle Aufgaben des Falls erledigt sind -> Fall abgeschlossen.
  const open = await db
    .select({ id: schema.returnTasks.id })
    .from(schema.returnTasks)
    .where(and(eq(schema.returnTasks.caseId, task.caseId), eq(schema.returnTasks.status, "pending")));
  if (open.length === 0) {
    await db
      .update(schema.returnCases)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(schema.returnCases.id, task.caseId));
  }
  revalidatePath("/returns");
}

export async function markReturnReceived(caseId: string, condition: string, restock: boolean) {
  const c = await db.query.returnCases.findFirst({ where: eq(schema.returnCases.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const { user } = await requireWrite(c.shopId, "returns");
  const cond = condition === "damaged" ? "damaged" : "resaleable";

  await db
    .update(schema.returnCases)
    .set({
      receivedAt: new Date(),
      condition: cond,
      restocked: cond === "resaleable" ? restock : false,
      receivedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.returnCases.id, caseId));

  // Beschädigt -> Lieferanten-Reklamation anlegen, falls noch keine existiert.
  if (cond === "damaged") {
    const existing = await db
      .select({ id: schema.returnTasks.id })
      .from(schema.returnTasks)
      .where(and(eq(schema.returnTasks.caseId, caseId), eq(schema.returnTasks.type, "supplier_claim")));
    if (existing.length === 0) {
      const items = (c.items as { title: string }[]) ?? [];
      const title = items[0]?.title ?? "Artikel";
      await db.insert(schema.returnTasks).values({
        caseId,
        shopId: c.shopId,
        type: "supplier_claim",
        title: `Lieferanten-Reklamation · ${title}`,
        instruction: `Beschädigte Rücksendung ${c.orderName} (${title}) beim Lieferanten reklamieren.`,
      });
    }
  }
  revalidatePath("/returns");
  revalidatePath("/returns/intake");
}

export async function receiveReturnForm(formData: FormData) {
  const caseId = String(formData.get("caseId") ?? "");
  const condition = String(formData.get("condition") ?? "resaleable");
  const restock = formData.get("restock") === "on";
  if (!caseId) throw new Error("Fall fehlt");
  return markReturnReceived(caseId, condition, restock);
}

export async function cancelReturnCase(caseId: string) {
  const c = await db.query.returnCases.findFirst({ where: eq(schema.returnCases.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  await requireWrite(c.shopId, "returns");
  await db
    .update(schema.returnCases)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(schema.returnCases.id, caseId));
  revalidatePath("/returns");
}
