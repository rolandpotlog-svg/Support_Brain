"use server";
// Einstellungen für den automatischen Versand. Einschalten/Freigeben nur durch den Inhaber;
// den NOTAUS darf jeder mit Schreibrecht im Shop drücken.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireOwner, requireWrite } from "@/server/access";
import { INTENTS } from "@/lib/support/intents";
import { NEVER_AUTO } from "@/server/ai/check";

export async function saveAutoSend(
  shopId: string,
  input: { autoSend: boolean; intents: string[]; delayMin: number; dailyMax: number },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireOwner();
    const valid = new Set<string>(INTENTS.map((i) => i.key));
    const intents = [...new Set(input.intents)].filter((k) => valid.has(k) && !NEVER_AUTO.has(k));
    const delayMin = Math.min(120, Math.max(2, Math.round(input.delayMin || 10)));
    const dailyMax = Math.min(500, Math.max(1, Math.round(input.dailyMax || 50)));
    await db
      .update(schema.shops)
      .set({ autoSend: input.autoSend, autoSendIntents: intents, autoSendDelayMin: delayMin, autoSendDailyMax: dailyMax })
      .where(eq(schema.shops.id, shopId));
    revalidatePath(`/admin/shops/${shopId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** NOTAUS: KI komplett aus (keine Entwürfe, keine Automatik) — oder wieder an. */
export async function setKillSwitch(shopId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    if (on) await requireWrite(shopId, "support");
    else await requireOwner(); // wieder einschalten nur durch den Inhaber
    await db.update(schema.shops).set({ killSwitch: on }).where(eq(schema.shops.id, shopId));
    revalidatePath(`/admin/shops/${shopId}`);
    revalidatePath("/inbox");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** NOTAUS Automatik: sofort aus + alle wartenden automatischen Antworten stoppen. Entwürfe laufen weiter. */
export async function emergencyStopAuto(shopId: string): Promise<{ ok: boolean; stopped?: number; error?: string }> {
  try {
    const { user } = await requireWrite(shopId, "support");
    await db.update(schema.shops).set({ autoSend: false }).where(eq(schema.shops.id, shopId));
    const { cancelAuto } = await import("@/server/ai/autosend");
    const pending = await db
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
      .innerJoin(schema.outbox, eq(schema.outbox.messageId, schema.messages.id))
      .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.aiOutcome, "auto"), eq(schema.outbox.status, "pending")));
    let stopped = 0;
    for (const p of pending) if (await cancelAuto(p.id, `Notaus von ${user.email}`)) stopped++;
    revalidatePath(`/admin/shops/${shopId}`);
    revalidatePath("/inbox");
    return { ok: true, stopped };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
