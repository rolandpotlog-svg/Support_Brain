"use server";
// Lernbuch: Regel-Vorschläge freigeben/verwerfen/bearbeiten, eigene Regeln anlegen. Nur Admin/Founder/Owner.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap } from "@/server/access";

async function loadLesson(id: string) {
  const l = await db.query.shopLesson.findFirst({ where: eq(schema.shopLesson.id, id) });
  if (!l) throw new Error("Regel nicht gefunden");
  return l;
}

export async function decideLesson(id: string, status: "aktiv" | "verworfen" | "vorschlag", rule?: string) {
  const l = await loadLesson(id);
  const { user } = await requireBrandCap(l.shopId, "settings");
  await db
    .update(schema.shopLesson)
    .set({ status, rule: rule?.trim() ? rule.trim().slice(0, 500) : l.rule, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(schema.shopLesson.id, id));
  revalidatePath("/gehirn");
}

export async function addLesson(shopId: string, rule: string, intent: string | null) {
  const { user } = await requireBrandCap(shopId, "settings");
  const r = rule.trim();
  if (r.length < 8) throw new Error("Bitte eine verständliche Regel eintragen.");
  await db.insert(schema.shopLesson).values({
    shopId,
    rule: r.slice(0, 500),
    intent: intent || null,
    source: "manual",
    status: "aktiv",
    decidedBy: user.id,
    decidedAt: new Date(),
  });
  revalidatePath("/gehirn");
}
