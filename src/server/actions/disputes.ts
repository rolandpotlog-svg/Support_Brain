"use server";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap, requireOwner } from "@/server/access";
import { loadShopifyCreds } from "@/server/shopify-config";
import {
  getDisputes,
  getOrderByName,
  submitDisputeEvidence,
  type DisputeEvidenceInput,
} from "@/lib/shopify/client";
import { evidenceTemplate } from "@/lib/disputes/reasons";
import { syncPaypalDisputes } from "@/server/paypal-disputes";

async function audit(caseId: string, userId: string, action: string, detail?: string) {
  await db.insert(schema.disputeAudit).values({ caseId, userId, action, detail: detail ?? null });
}

/** Shopify-Payments-Disputes holen, upserten und an Bestellung/Ticket hängen. */
export async function syncDisputes(shopId: string): Promise<{ count: number }> {
  await requireBrandCap(shopId, "cases");
  const creds = await loadShopifyCreds(shopId);
  if (!creds) throw new Error("Shopify für diesen Shop nicht konfiguriert");
  const disputes = await getDisputes(creds);

  for (const d of disputes) {
    let threadId: string | null = null;
    if (d.customerEmail) {
      const t = await db.query.threads.findFirst({
        where: and(
          eq(schema.threads.shopId, shopId),
          sql`lower(${schema.threads.customerEmail}) = lower(${d.customerEmail})`,
        ),
      });
      threadId = t?.id ?? null;
    }
    const outcome = d.status === "WON" ? "won" : d.status === "LOST" ? "lost" : null;
    const common = {
      providerEvidenceId: d.evidenceId,
      orderId: d.orderId,
      orderName: d.orderName,
      threadId,
      customerEmail: d.customerEmail,
      customerName: d.customerName,
      amount: d.amount,
      currency: d.currency,
      reason: d.reason,
      reasonCode: d.reasonCode,
      type: d.type,
      status: d.status,
      dueBy: d.evidenceDueBy ? new Date(d.evidenceDueBy) : null,
      initiatedAt: d.initiatedAt ? new Date(d.initiatedAt) : null,
      submittedAt: d.evidenceSentOn ? new Date(d.evidenceSentOn) : null,
      outcome,
      raw: d,
    };
    await db
      .insert(schema.disputeCase)
      .values({ shopId, source: "shopify_payments", providerCaseId: d.id, ...common })
      .onConflictDoUpdate({
        target: [
          schema.disputeCase.shopId,
          schema.disputeCase.source,
          schema.disputeCase.providerCaseId,
        ],
        set: { ...common, updatedAt: new Date() },
      });
  }
  revalidatePath("/cases");
  return { count: disputes.length };
}

/** Alle Shopify-konfigurierten Shops auf einmal synchronisieren (Dashboard-Button). */
export async function syncAllDisputes(): Promise<{ count: number; shops: number; errors: string[] }> {
  await requireOwner();
  const shops = await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops);
  let count = 0;
  let synced = 0;
  const errors: string[] = [];
  for (const s of shops) {
    // PayPal-Fälle (falls Zugang hinterlegt) gleich mit abrufen.
    try {
      const pp = await syncPaypalDisputes(s.id);
      count += pp.count;
    } catch (e) {
      errors.push(`${s.name} (PayPal): ${e instanceof Error ? e.message : String(e)}`);
    }
    const creds = await loadShopifyCreds(s.id);
    if (!creds) continue;
    try {
      const r = await syncDisputes(s.id);
      count += r.count;
      synced++;
    } catch (e) {
      errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  revalidatePath("/cases");
  return { count, shops: synced, errors };
}

/** Beweispaket deterministisch zusammenbauen (Bestellung, Tracking, Ticket-Kommunikation). */
export async function assembleEvidence(caseId: string): Promise<Record<string, string>> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const { user } = await requireBrandCap(c.shopId, "cases");
  const creds = await loadShopifyCreds(c.shopId);

  let tracking: string | null = null;
  let carrier: string | null = null;
  if (creds && c.orderName) {
    try {
      const hit = await getOrderByName(creds, c.orderName);
      const t = hit?.order.tracking?.[0];
      tracking = t?.number ?? null;
      carrier = t?.company ?? null;
    } catch {
      /* best effort */
    }
  }

  let supportSummary: string | null = null;
  if (c.threadId) {
    const msgs = await db
      .select({
        direction: schema.messages.direction,
        internal: schema.messages.internal,
        bodyText: schema.messages.bodyText,
      })
      .from(schema.messages)
      .where(eq(schema.messages.threadId, c.threadId))
      .orderBy(schema.messages.createdAt);
    const parts = msgs
      .filter((m) => !m.internal && m.bodyText)
      .map((m) => `${m.direction === "inbound" ? "Kunde" : "Support"}: ${m.bodyText!.replace(/\s+/g, " ").trim()}`);
    if (parts.length) supportSummary = parts.join(" | ").slice(0, 800);
  }

  const [first, ...rest] = (c.customerName ?? "").trim().split(/\s+/);
  const evidence: Record<string, string> = {
    uncategorizedText: evidenceTemplate(c.reason, {
      orderName: c.orderName,
      customerName: c.customerName,
      tracking,
      carrier,
      supportSummary,
    }),
    customerEmailAddress: c.customerEmail ?? "",
    customerFirstName: first ?? "",
    customerLastName: rest.join(" "),
    accessActivityLog: "",
    cancellationRebuttal: "",
    refundPolicyDisclosure: "",
  };
  await db
    .update(schema.disputeCase)
    .set({ evidence, updatedAt: new Date() })
    .where(eq(schema.disputeCase.id, caseId));
  await audit(caseId, user.id, "evidence_assembled", "Beweispaket-Entwurf erzeugt");
  revalidatePath(`/cases/${caseId}`);
  return evidence;
}

export async function saveEvidence(caseId: string, evidence: Record<string, string>): Promise<void> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const { user } = await requireBrandCap(c.shopId, "cases");
  await db
    .update(schema.disputeCase)
    .set({ evidence, updatedAt: new Date() })
    .where(eq(schema.disputeCase.id, caseId));
  await audit(caseId, user.id, "evidence_saved", "Beweis gespeichert");
  revalidatePath(`/cases/${caseId}`);
}

export async function setDecision(caseId: string, decision: "fight" | "accept"): Promise<void> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const { user } = await requireBrandCap(c.shopId, "cases");
  await db
    .update(schema.disputeCase)
    .set({ decision, updatedAt: new Date() })
    .where(eq(schema.disputeCase.id, caseId));
  await audit(
    caseId,
    user.id,
    decision === "accept" ? "decision_accept" : "decision_fight",
    decision === "accept" ? "Akzeptieren gewählt" : "Kämpfen gewählt",
  );
  revalidatePath(`/cases/${caseId}`);
}

/** GELDBEWEGEND: Beweis bei Shopify einreichen. Nur per expliziter Mensch-Aktion (Testphase). */
export async function submitEvidence(caseId: string): Promise<{ ok: boolean; status: string | null }> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const { user } = await requireBrandCap(c.shopId, "cases");
  if (c.source !== "shopify_payments") throw new Error("Einreichen ist nur für Shopify-Payments-Fälle möglich");
  if (!c.providerEvidenceId) throw new Error("Keine Evidence-ID — bitte zuerst aus Shopify aktualisieren.");
  if (c.submittedAt) throw new Error("Beweis wurde bereits eingereicht.");

  const creds = await loadShopifyCreds(c.shopId);
  if (!creds) throw new Error("Shopify nicht konfiguriert");

  const ev = c.evidence ?? {};
  const input: DisputeEvidenceInput = {
    customerEmailAddress: ev.customerEmailAddress || undefined,
    customerFirstName: ev.customerFirstName || undefined,
    customerLastName: ev.customerLastName || undefined,
    uncategorizedText: ev.uncategorizedText || undefined,
    accessActivityLog: ev.accessActivityLog || undefined,
    cancellationRebuttal: ev.cancellationRebuttal || undefined,
    refundPolicyDisclosure: ev.refundPolicyDisclosure || undefined,
  };

  const res = await submitDisputeEvidence(creds, c.providerEvidenceId, input, true);
  if (!res.ok) throw new Error("Shopify: " + res.errors.join("; "));

  await db
    .update(schema.disputeCase)
    .set({ submittedAt: new Date(), status: res.status ?? "UNDER_REVIEW", decision: "fight", updatedAt: new Date() })
    .where(eq(schema.disputeCase.id, caseId));
  await audit(caseId, user.id, "submitted", `Eingereicht: ${c.amount ?? "?"} ${c.currency ?? ""}`.trim());
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return { ok: true, status: res.status ?? "UNDER_REVIEW" };
}
