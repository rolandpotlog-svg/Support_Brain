// Produkt-Analyse je Shop: welche Produkte machen welche Probleme (Tickets, Retouren, Reklamationen) — und
// welche werden gelobt. Grundlage: Anliegen-Erkennung (aiIntent/aiIssue/aiItem = echter Shopify-Titel, wenn
// die Bestellung zugeordnet ist), Retouren-Positionen (Shopify-Titel + Grund) und Reklamationen.
import { and, eq, gte, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { PROBLEM_INTENTS, intentShort, type IntentKey } from "@/lib/support/intents";

export type IssueRow = { issue: string; n: number; prev: number; examples: { threadId: string; number: number; summary: string }[] };
export type ProductRow = {
  product: string;
  tickets: number; // alle Tickets zum Produkt
  problems: number; // Tickets mit Produktproblem
  problemsPrev: number;
  issues: IssueRow[];
  returns: number;
  returnReasons: { reason: string; n: number }[];
  claims: number; // reklamierte Stück
  praise: number;
  status: "rot" | "gelb" | "gruen";
};

const key = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export async function productInsights(shopId: string, days: number): Promise<{ rows: ProductRow[]; unassigned: number }> {
  const now = Date.now();
  const from = new Date(now - days * 86_400_000);
  const prevFrom = new Date(now - 2 * days * 86_400_000);

  const threads = await db
    .select({
      id: schema.threads.id,
      number: schema.threads.number,
      intent: schema.threads.aiIntent,
      issue: schema.threads.aiIssue,
      item: schema.threads.aiItem,
      praise: schema.threads.aiPraise,
      summary: schema.threads.aiSummary,
      createdAt: schema.threads.createdAt,
    })
    .from(schema.threads)
    .where(and(eq(schema.threads.shopId, shopId), isNull(schema.threads.deletedAt), gte(schema.threads.createdAt, prevFrom)));

  const map = new Map<string, ProductRow & { _issues: Map<string, IssueRow> }>();
  const get = (name: string) => {
    const k = key(name);
    let r = map.get(k);
    if (!r) {
      r = { product: name, tickets: 0, problems: 0, problemsPrev: 0, issues: [], returns: 0, returnReasons: [], claims: 0, praise: 0, status: "gruen", _issues: new Map() };
      map.set(k, r);
    }
    return r;
  };

  let unassigned = 0;
  for (const t of threads) {
    const isCur = t.createdAt >= from;
    const isProblem = PROBLEM_INTENTS.has((t.intent ?? "") as IntentKey);
    if (!t.item) {
      if (isCur && isProblem) unassigned++;
      continue;
    }
    const r = get(t.item);
    if (isCur) {
      r.tickets++;
      if (t.praise) r.praise++;
    }
    if (!isProblem) continue;
    if (!isCur) {
      r.problemsPrev++;
    } else {
      r.problems++;
    }
    const iname = t.issue || intentShort(t.intent);
    const ik = key(iname);
    let ir = r._issues.get(ik);
    if (!ir) {
      ir = { issue: iname, n: 0, prev: 0, examples: [] };
      r._issues.set(ik, ir);
    }
    if (isCur) {
      ir.n++;
      if (ir.examples.length < 5 && t.summary) ir.examples.push({ threadId: t.id, number: t.number, summary: t.summary });
    } else ir.prev++;
  }

  // Retouren (Positionen mit Grund) im aktuellen Zeitraum
  const rets = await db
    .select({ items: schema.returnCases.items })
    .from(schema.returnCases)
    .where(and(eq(schema.returnCases.shopId, shopId), gte(schema.returnCases.createdAt, from)));
  for (const rc of rets) {
    for (const it of ((rc.items as { title?: string; reasonLabel?: string; quantity?: number }[] | null) ?? [])) {
      if (!it.title) continue;
      const r = get(it.title);
      r.returns += Number(it.quantity ?? 1) || 1;
      const reason = it.reasonLabel || "ohne Grund";
      const e = r.returnReasons.find((x) => x.reason === reason);
      if (e) e.n++;
      else r.returnReasons.push({ reason, n: 1 });
    }
  }

  // Reklamationen an den Lieferanten
  const claims = await db
    .select({ label: schema.supplierClaim.productLabel, qty: schema.supplierClaim.quantity })
    .from(schema.supplierClaim)
    .where(and(eq(schema.supplierClaim.shopId, shopId), gte(schema.supplierClaim.createdAt, from)));
  for (const c of claims) get(c.label).claims += c.qty;

  const rows: ProductRow[] = [...map.values()]
    .map(({ _issues, ...r }) => {
      const issues = [..._issues.values()].filter((i) => i.n > 0 || i.prev > 0).sort((a, b) => b.n - a.n);
      const topIssue = issues[0]?.n ?? 0;
      const rising = r.problems > r.problemsPrev * 1.5 && r.problems >= 3;
      // Ampel: dasselbe Problem ≥ 5× oder stark steigend = rot; ≥ 2× oder Retouren/Reklamationen = gelb.
      const status: ProductRow["status"] = topIssue >= 5 || rising ? "rot" : topIssue >= 2 || r.claims > 0 || r.returns >= 3 ? "gelb" : "gruen";
      return { ...r, issues, returnReasons: r.returnReasons.sort((a, b) => b.n - a.n), status };
    })
    .filter((r) => r.tickets + r.returns + r.claims + r.problemsPrev > 0)
    .sort((a, b) => b.problems + b.returns + b.claims - (a.problems + a.returns + a.claims) || b.praise - a.praise);

  return { rows, unassigned };
}
