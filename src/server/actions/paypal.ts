"use server";
// PayPal-Zugang je Shop speichern/testen + Fälle manuell abrufen. Nur Admin/Founder/Owner des Shops.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";
import { paypalToken } from "@/lib/paypal/client";
import { loadPaypalCreds, syncPaypalDisputes } from "@/server/paypal-disputes";

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
    return { ok: true, message: `✓ Verbunden (${c.mode === "live" ? "Live" : "Sandbox"}) — ${r.count} Fall/Fälle aus den letzten ~170 Tagen abgerufen.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** KI-Stellungnahme an PayPal entwerfen: Fall + Bestellung/Tracking + Ticketverlauf + Shop-Regeln. Wird NICHT gesendet. */
export async function draftPaypalResponse(caseId: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
    if (!c) return { ok: false, error: "Fall nicht gefunden" };
    await requireBrandCap(c.shopId, "cases");
    const { complete } = await import("@/server/ai");
    const { loadShopifyCreds } = await import("@/server/shopify-config");
    const { getOrderByName, trackingUrl } = await import("@/lib/shopify/client");
    const { bestBodyText } = await import("@/lib/mailbox/html-text");
    const { reasonInfo } = await import("@/lib/disputes/reasons");

    // Bestellung + Versand
    let orderInfo = "Keine Bestellung sicher zugeordnet.";
    if (c.orderName) {
      const creds = await loadShopifyCreds(c.shopId);
      const hit = creds ? await getOrderByName(creds, c.orderName).catch(() => null) : null;
      if (hit) {
        const o = hit.order;
        const tr = o.tracking.map((t) => `${t.company ?? ""} ${t.number ?? ""} ${trackingUrl(t) ?? ""}`.trim()).join(" | ");
        const del = o.delivery?.status ? `${o.delivery.status}${o.delivery.deliveredAt ? ` am ${new Date(o.delivery.deliveredAt).toLocaleDateString("de-DE")}` : ""}` : "unbekannt";
        const items = o.lineItems.map((li) => `${li.quantity}× ${li.title}${li.variantTitle ? ` (${li.variantTitle})` : ""}${li.properties.length ? ` [Personalisierung: ${li.properties.map((p) => `${p.key}: ${p.value}`).join("; ")}]` : ""}`).join(", ");
        orderInfo = `Bestellung ${o.name} vom ${new Date(o.createdAt).toLocaleDateString("de-DE")}, Betrag ${o.total?.amount ?? "?"} ${o.total?.currencyCode ?? ""}\nArtikel: ${items}\nVersand: ${o.fulfillmentStatus ?? "?"} · Sendungsstatus: ${del}\nTracking: ${tr || "keins"}\nLieferadresse: ${[o.shippingAddress?.name, o.shippingAddress?.address1, o.shippingAddress?.zip, o.shippingAddress?.city, o.shippingAddress?.country].filter(Boolean).join(", ")}`;
      }
    }
    // Kundenkommunikation (Support-Ticket)
    let comms = "Kein Support-Ticket zugeordnet.";
    if (c.threadId) {
      const msgs = await db
        .select({ direction: schema.messages.direction, internal: schema.messages.internal, bodyText: schema.messages.bodyText, bodyHtml: schema.messages.bodyHtml, createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.threadId, c.threadId))
        .orderBy(schema.messages.createdAt);
      comms = msgs
        .filter((m) => !m.internal)
        .map((m) => `${m.createdAt.toLocaleDateString("de-DE")} ${m.direction === "inbound" ? "Kunde" : "Wir"}: ${(bestBodyText(m.bodyText, m.bodyHtml) ?? "").replace(/\s+/g, " ").slice(0, 600)}`)
        .join("\n") || comms;
    }
    // PayPal-Nachrichten + Shop-Regeln
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = c.raw ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ppMsgs = (raw.messages ?? []).map((m: any) => `${m.posted_by}: ${m.content}`).join("\n") || "keine";
    const profile = await db.query.shopProfile.findFirst({ where: eq(schema.shopProfile.shopId, c.shopId) });
    const p = profile?.data;
    const rules = p ? [p.notReturnable, p.returnPeriod, p.shipping, p.refund].filter(Boolean).join("\n") : "";

    const text = await complete({
      system:
        "Du schreibst für einen Online-Shop die Stellungnahme an PayPal in einem Käuferschutzfall. Sachlich, höflich, kurz, belegbar, auf Deutsch. " +
        "Nur Fakten aus den gegebenen Daten verwenden — nichts erfinden. Chronologisch: Bestellung, Versand/Zustellung, Kommunikation mit dem Kunden, warum der Anspruch (nicht) berechtigt ist. " +
        "Bei personalisierter/gravierter Ware auf den gesetzlichen Ausschluss vom Widerrufsrecht hinweisen. Wenn die Faktenlage schwach ist (z. B. keine Zustellung belegt), das ehrlich als Hinweis fürs Team voranstellen. " +
        "Format: 1) Eine Zeile „EMPFEHLUNG: kämpfen|akzeptieren — Grund“ (fürs Team). 2) Die Stellungnahme an PayPal. 3) „BELEGE ANHÄNGEN:“ als Liste (z. B. Sendungsverfolgung mit Zustellnachweis, Bestellbestätigung, E-Mail-Verlauf).",
      messages: [
        {
          role: "user",
          content: [
            `FALL: PayPal ${c.type ?? ""} · Grund: ${c.reasonCode ?? c.reason} (${reasonInfo(c.reason).label}) · Betrag ${c.amount ?? "?"} ${c.currency ?? ""}`,
            `Käufer: ${c.customerName ?? "?"} <${c.customerEmail ?? "?"}>`,
            `Zuordnung zur Bestellung: ${c.matchConfidence ?? "?"} (${c.matchNote ?? ""})`,
            "",
            "PAYPAL-NACHRICHTEN:",
            ppMsgs,
            "",
            "BESTELLUNG / VERSAND:",
            orderInfo,
            "",
            "KOMMUNIKATION MIT DEM KUNDEN:",
            comms,
            "",
            "SHOP-REGELN:",
            rules || "(keine)",
          ].join("\n"),
        },
      ],
      maxTokens: 6000,
      effort: "medium",
      kind: "dispute",
      shopId: c.shopId,
    });
    const evidence = { ...(c.evidence ?? {}), paypalResponse: text };
    await db.update(schema.disputeCase).set({ evidence, updatedAt: new Date() }).where(eq(schema.disputeCase.id, caseId));
    await db.insert(schema.disputeAudit).values({ caseId, userId: (await (await import("@/server/access")).requireUser()).id, action: "evidence_assembled", detail: "KI-Stellungnahme an PayPal entworfen" });
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function savePaypalResponse(caseId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) return { ok: false, error: "Fall nicht gefunden" };
  await requireBrandCap(c.shopId, "cases");
  await db.update(schema.disputeCase).set({ evidence: { ...(c.evidence ?? {}), paypalResponse: text }, updatedAt: new Date() }).where(eq(schema.disputeCase.id, caseId));
  revalidatePath(`/cases/${caseId}`);
  return { ok: true };
}
