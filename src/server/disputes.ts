// Lese-Helfer fürs Dispute-Dashboard. Schreibende Logik: actions/disputes.ts.
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type CaseRow = {
  id: string;
  shopId: string;
  shopName: string;
  source: string;
  status: string;
  amount: string | null;
  currency: string | null;
  reason: string | null;
  reasonCode: string | null;
  dueBy: Date | null;
  orderName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  threadId: string | null;
  threadNumber: number | null;
  decision: string | null;
  submittedAt: Date | null;
  outcome: string | null;
  externalUrl: string | null;
};

const OPEN_STATUS = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);

export async function listCases(shopIds: string[]): Promise<CaseRow[]> {
  if (!shopIds.length) return [];
  return db
    .select({
      id: schema.disputeCase.id,
      shopId: schema.disputeCase.shopId,
      shopName: schema.shops.name,
      source: schema.disputeCase.source,
      status: schema.disputeCase.status,
      amount: schema.disputeCase.amount,
      currency: schema.disputeCase.currency,
      reason: schema.disputeCase.reason,
      reasonCode: schema.disputeCase.reasonCode,
      dueBy: schema.disputeCase.dueBy,
      orderName: schema.disputeCase.orderName,
      customerName: schema.disputeCase.customerName,
      customerEmail: schema.disputeCase.customerEmail,
      threadId: schema.disputeCase.threadId,
      threadNumber: schema.threads.number,
      decision: schema.disputeCase.decision,
      submittedAt: schema.disputeCase.submittedAt,
      outcome: schema.disputeCase.outcome,
      externalUrl: schema.disputeCase.externalUrl,
    })
    .from(schema.disputeCase)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.disputeCase.shopId))
    .leftJoin(schema.threads, eq(schema.threads.id, schema.disputeCase.threadId))
    .where(inArray(schema.disputeCase.shopId, shopIds));
}

export type CaseReport = {
  open: number;
  won: number;
  lost: number;
  recovered: Record<string, number>;
};

export function reportFrom(rows: CaseRow[]): CaseReport {
  let open = 0, won = 0, lost = 0;
  const recovered: Record<string, number> = {};
  for (const r of rows) {
    const st = (r.status || "").toUpperCase();
    if (st === "WON") {
      won++;
      const cur = r.currency || "EUR";
      recovered[cur] = (recovered[cur] || 0) + (parseFloat(r.amount || "0") || 0);
    } else if (st === "LOST") {
      lost++;
    } else if (OPEN_STATUS.has(st)) {
      open++;
    }
  }
  return { open, won, lost, recovered };
}

export type AuditRow = { action: string; detail: string | null; createdAt: Date; userEmail: string | null };

export async function loadCase(id: string) {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, id) });
  if (!c) return null;

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, c.shopId) });
  const thread = c.threadId
    ? await db.query.threads.findFirst({ where: eq(schema.threads.id, c.threadId) })
    : null;

  const audit: AuditRow[] = await db
    .select({
      action: schema.disputeAudit.action,
      detail: schema.disputeAudit.detail,
      createdAt: schema.disputeAudit.createdAt,
      userEmail: schema.users.email,
    })
    .from(schema.disputeAudit)
    .leftJoin(schema.users, eq(schema.users.id, schema.disputeAudit.userId))
    .where(eq(schema.disputeAudit.caseId, id))
    .orderBy(desc(schema.disputeAudit.createdAt));

  return {
    case: c,
    shopName: shop?.name ?? "",
    thread: thread
      ? { id: thread.id, number: thread.number, subject: thread.subject, customerEmail: thread.customerEmail }
      : null,
    audit,
  };
}
