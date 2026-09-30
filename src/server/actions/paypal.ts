"use server";
// PayPal-Zugang je Shop speichern/testen + Fälle manuell abrufen. Nur Admin/Founder/Owner des Shops.
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";
import {
  acceptPaypalClaim,
  allowedActions,
  getPaypalDispute,
  makePaypalOffer,
  paypalToken,
  providePaypalEvidence,
  sendPaypalMessage,
} from "@/lib/paypal/client";
import { loadPaypalCreds, refreshPaypalCase, syncPaypalDisputes } from "@/server/paypal-disputes";
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

export type PaypalActionInput =
  | { kind: "message"; text: string }
  | { kind: "tracking"; tracking: { company: string | null; number: string }[]; note: string }
  | { kind: "statement"; text: string; tracking: { company: string | null; number: string }[] }
  | { kind: "refund"; amount: string; note: string; confirm: string }
  | { kind: "replacement"; note: string };

const ACTION_AUDIT: Record<PaypalActionInput["kind"], string> = {
  message: "Nachricht an Käufer gesendet (PayPal)",
  tracking: "Tracking nachgereicht (PayPal)",
  statement: "Stellungnahme eingereicht (PayPal)",
  refund: "Erstattung ausgelöst (PayPal)",
  replacement: "Ersatz angeboten (PayPal)",
};

/**
 * Aktion direkt in PayPal ausführen. Erlaubt ist nur, was PayPal für den Fall gerade anbietet (links/rel).
 * Geld-Aktionen brauchen die Bestätigung des Betrags. Bei Netzwerkfehler KEIN automatischer Retry
 * (die Aktion kann trotzdem angekommen sein) — stattdessen Fall neu laden und Stand zeigen.
 */
export async function paypalAction(caseId: string, input: PaypalActionInput): Promise<{ ok: boolean; message?: string; error?: string }> {
  let locked = false;
  try {
    const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
    if (!c || c.source !== "paypal") return { ok: false, error: "Fall nicht gefunden" };
    const { user } = await requireBrandCap(c.shopId, "cases");
    const creds = await loadPaypalCreds(c.shopId);
    if (!creds) return { ok: false, error: "Kein PayPal-Zugang für diesen Shop." };

    // Eingaben prüfen, bevor irgendetwas an PayPal geht
    if (input.kind === "refund") {
      const a = Number(input.amount.replace(",", "."));
      if (!(a > 0)) return { ok: false, error: "Betrag fehlt." };
      if (input.confirm.replace(",", ".").trim() !== a.toFixed(2)) return { ok: false, error: `Bestätigung passt nicht zum Betrag (bitte ${a.toFixed(2)} eintippen).` };
    }
    if ((input.kind === "message" || input.kind === "statement") && !input.text.trim()) return { ok: false, error: "Text ist leer." };

    // Doppelklick-/Parallel-Schutz: nur eine Aktion je Fall gleichzeitig (Sperre verfällt nach 2 Min.)
    const lock = await db
      .update(schema.disputeCase)
      .set({ evidence: sql`coalesce(${schema.disputeCase.evidence}, '{}'::jsonb) || jsonb_build_object('ppLock', now()::text)` })
      .where(
        and(
          eq(schema.disputeCase.id, caseId),
          sql`coalesce((${schema.disputeCase.evidence}->>'ppLock')::timestamptz, 'epoch') < now() - interval '2 minutes'`,
        ),
      )
      .returning({ id: schema.disputeCase.id });
    if (!lock.length) return { ok: false, error: "Für diesen Fall läuft gerade schon eine Aktion." };
    locked = true;

    const { token } = await paypalToken(creds);
    const fresh = await getPaypalDispute(creds, token, c.providerCaseId);
    const allowed = allowedActions(fresh.raw);
    const need = (rel: string) => {
      if (!allowed.includes(rel)) throw new Error(`PayPal erlaubt diese Aktion in der aktuellen Phase nicht (möglich: ${allowed.join(", ") || "keine"}).`);
    };
    const currency = fresh.dispute_amount?.currency_code ?? c.currency ?? "EUR";
    const disputed = Number(fresh.dispute_amount?.value ?? c.amount ?? 0);

    let detail = "";
    switch (input.kind) {
      case "message": {
        const text = input.text.trim();
        if (!text) return { ok: false, error: "Nachricht ist leer." };
        need("send_message");
        await sendPaypalMessage(creds, token, c.providerCaseId, text.slice(0, 2000));
        detail = text.slice(0, 120);
        break;
      }
      case "tracking": {
        const tr = input.tracking.filter((t) => t.number.trim());
        if (!tr.length) return { ok: false, error: "Keine Sendungsnummer angegeben." };
        need("provide_evidence");
        await providePaypalEvidence(creds, token, c.providerCaseId, { notes: input.note.trim() || "Sendungsverfolgung zur Bestellung.", tracking: tr });
        detail = tr.map((t) => `${t.company ?? ""} ${t.number}`.trim()).join(", ");
        break;
      }
      case "statement": {
        if (!input.text.trim()) return { ok: false, error: "Stellungnahme ist leer." };
        need("provide_evidence");
        await providePaypalEvidence(creds, token, c.providerCaseId, {
          notes: input.text.trim().slice(0, 2000),
          tracking: input.tracking.filter((t) => t.number.trim()),
        });
        detail = "Stellungnahme + Belege";
        break;
      }
      case "refund": {
        const amount = Number(input.amount.replace(",", "."));
        if (!(amount > 0)) return { ok: false, error: "Betrag fehlt." };
        if (amount > disputed + 0.001) return { ok: false, error: `Höchstens ${disputed.toFixed(2)} ${currency} möglich.` };
        if (input.confirm.replace(",", ".").trim() !== amount.toFixed(2)) return { ok: false, error: "Bestätigung passt nicht zum Betrag." };
        const money = { currency_code: currency, value: amount.toFixed(2) };
        const full = Math.abs(amount - disputed) < 0.005;
        if (full && allowed.includes("accept_claim")) {
          await acceptPaypalClaim(creds, token, c.providerCaseId, { note: input.note.trim() || "Wir erstatten den Betrag.", amount: money });
        } else if (allowed.includes("make_offer")) {
          await makePaypalOffer(creds, token, c.providerCaseId, { note: input.note.trim() || "Wir erstatten Ihnen den Betrag.", type: "REFUND", amount: money });
        } else {
          need(full ? "accept_claim" : "make_offer");
        }
        detail = `${money.value} ${currency}${full ? " (voll)" : " (Teil)"}`;
        await db.update(schema.disputeCase).set({ decision: "accept" }).where(eq(schema.disputeCase.id, caseId));
        break;
      }
      case "replacement": {
        need("make_offer");
        await makePaypalOffer(creds, token, c.providerCaseId, { note: input.note.trim() || "Wir senden Ihnen kostenlos Ersatz.", type: "REPLACEMENT_WITHOUT_REFUND" });
        detail = "Ersatz ohne Erstattung";
        break;
      }
    }
    await db.insert(schema.disputeAudit).values({ caseId, userId: user.id, action: `paypal_${input.kind}`, detail: `${ACTION_AUDIT[input.kind]}: ${detail}` });
    await refreshPaypalCase(caseId).catch(() => null);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath("/cases");
    return { ok: true, message: `✓ ${ACTION_AUDIT[input.kind]}.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|network|timeout|ECONN/i.test(msg)) {
      await refreshPaypalCase(caseId).catch(() => null);
      revalidatePath(`/cases/${caseId}`);
      return { ok: false, error: "Verbindung zu PayPal abgebrochen. Die Aktion ist evtl. trotzdem angekommen: Verlauf unten prüfen, NICHT einfach nochmal klicken." };
    }
    return { ok: false, error: msg };
  } finally {
    if (locked) {
      await db
        .update(schema.disputeCase)
        .set({ evidence: sql`coalesce(${schema.disputeCase.evidence}, '{}'::jsonb) - 'ppLock'` })
        .where(eq(schema.disputeCase.id, caseId))
        .catch(() => null);
    }
  }
}
