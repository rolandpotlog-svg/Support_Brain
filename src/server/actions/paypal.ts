"use server";
// PayPal-Zugang je Shop speichern/testen + Fälle manuell abrufen. Nur Admin/Founder/Owner des Shops.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";
import { paypalToken } from "@/lib/paypal/client";
import { loadPaypalCreds, syncPaypalDisputes } from "@/server/paypal-disputes";
import { buildPaypalDraft, type PaypalDraft } from "@/server/paypal-draft";

export async function savePaypalAccess(
  shopId: string,
  input: { clientId: string; clientSecret: string; mode: "sandbox" | "live" },
): Promise<{ ok: boolean; error?: string }> {
  await requireBrandCap(shopId, "settings");
  const clientId = input.clientId.trim();
  const existing = await db.query.shopPaypal.findFirst({ where: eq(schema.shopPaypal.shopId, shopId) });
  if (!clientId) {
    if (existing) await db.delete(schema.shopPaypal).where(eq(schema.shopPaypal.shopId, shopId));
    revalidatePath(`/admin/shops/${shopId}`);
    return { ok: true };
  }
  const secretEnc = input.clientSecret.trim() ? encrypt(input.clientSecret.trim()) : existing?.clientSecretEnc;
  if (!secretEnc) return { ok: false, error: "Bitte das Client Secret eintragen." };
  await db
    .insert(schema.shopPaypal)
    .values({ shopId, clientId, clientSecretEnc: secretEnc, mode: input.mode })
    .onConflictDoUpdate({ target: schema.shopPaypal.shopId, set: { clientId, clientSecretEnc: secretEnc, mode: input.mode, updatedAt: new Date(), lastSyncAt: null } });
  revalidatePath(`/admin/shops/${shopId}`);
  return { ok: true };
}

/** Anmeldung testen + Fälle sofort abrufen. */
export async function testPaypalAccess(shopId: string): Promise<{ ok: boolean; message: string }> {
  await requireBrandCap(shopId, "settings");
  const c = await loadPaypalCreds(shopId);
  if (!c) return { ok: false, message: "Noch kein PayPal-Zugang gespeichert." };
  try {
    await paypalToken(c);
    const r = await syncPaypalDisputes(shopId);
    revalidatePath("/cases");
    const shared = r.count !== r.forShop ? ` (${r.forShop} davon diesem Shop zugeordnet, Rest dem anderen Shop mit demselben PayPal-Konto)` : "";
    return { ok: true, message: `✓ Verbunden (${c.mode === "live" ? "Live" : "Sandbox"}) — ${r.count} Fall/Fälle aus den letzten ~170 Tagen abgerufen${shared}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** KI-Stellungnahme an PayPal entwerfen: Fall + Bestellung/Tracking + Ticketverlauf + Shop-Regeln. Wird NICHT gesendet. */
/** KI-Entwurf (Empfehlung + Nachricht an Käufer + ggf. Stellungnahme) für einen PayPal-Fall. */
export async function draftPaypalResponse(caseId: string): Promise<{ ok: boolean; draft?: PaypalDraft; error?: string }> {
  try {
    const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
    if (!c) return { ok: false, error: "Fall nicht gefunden" };
    const { user } = await requireBrandCap(c.shopId, "cases");
    const draft = await buildPaypalDraft(caseId, user.id);
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function savePaypalResponse(
  caseId: string,
  texts: { buyerMessage: string; statement: string },
): Promise<{ ok: boolean; error?: string }> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) return { ok: false, error: "Fall nicht gefunden" };
  await requireBrandCap(c.shopId, "cases");
  await db
    .update(schema.disputeCase)
    .set({ evidence: { ...(c.evidence ?? {}), paypalBuyerMessage: texts.buyerMessage, paypalResponse: texts.statement }, updatedAt: new Date() })
    .where(eq(schema.disputeCase.id, caseId));
  revalidatePath(`/cases/${caseId}`);
  return { ok: true };
}

/** Fall eines gemeinsamen PayPal-Kontos manuell einem anderen Shop zuordnen (bleibt bei künftigen Abrufen so). */
export async function movePaypalCase(caseId: string, targetShopId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
    if (!c || c.source !== "paypal") return { ok: false, error: "Fall nicht gefunden" };
    const { user } = await requireBrandCap(c.shopId, "cases");
    await requireBrandCap(targetShopId, "cases");
    const { paypalSiblingShops } = await import("@/server/paypal-disputes");
    if (!(await paypalSiblingShops(c.shopId)).some((s) => s.id === targetShopId)) {
      return { ok: false, error: "Dieser Shop nutzt nicht dasselbe PayPal-Konto." };
    }
    const target = await db.query.shops.findFirst({ where: eq(schema.shops.id, targetShopId) });
    await db
      .update(schema.disputeCase)
      .set({
        shopId: targetShopId,
        // Bestellung/Ticket gehören zum alten Shop -> neu zuordnen lassen
        orderId: null,
        orderName: null,
        threadId: null,
        facts: null,
        matchConfidence: "keine",
        matchNote: `Manuell ${target?.name ?? "anderem Shop"} zugeordnet`,
        // Entwurf gehörte zum alten Shop (Signatur, Bestellung) -> verwerfen, Worker entwirft neu
        evidence: (() => {
          const { paypalAdvice: _a, paypalBuyerMessage: _b, paypalResponse: _r, paypalEvidence: _e, paypalDraftFailedAt: _f, ...rest } = c.evidence ?? {};
          return { ...rest, manualShop: "1" };
        })(),
        raw: { ...(c.raw ?? {}), update_time: null },
        updatedAt: new Date(),
      })
      .where(eq(schema.disputeCase.id, caseId));
    await db.insert(schema.disputeAudit).values({ caseId, userId: user.id, action: "moved_shop", detail: `→ ${target?.name ?? targetShopId}` });
    // gleich neu abgleichen (Bestellung/Ticket im neuen Shop)
    await syncPaypalDisputes(targetShopId).catch(() => null);
    revalidatePath("/cases");
    revalidatePath(`/cases/${caseId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
