import Link from "next/link";
import { redirect } from "next/navigation";
import { accessibleShopIds, requireUser } from "@/server/access";
import { listCases, reportFrom, type CaseRow } from "@/server/disputes";
import { euro } from "@/lib/format";
import { countdownLabel, reasonInfo, statusLabel, urgency } from "@/lib/disputes/reasons";
import { SyncDisputesButton } from "./sync-disputes-button";

const URGENCY_CLASS: Record<string, string> = {
  overdue: "rose",
  urgent: "rose",
  soon: "amber",
  ok: "green",
  none: "muted",
};

const OPEN_STATUS = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);

export default async function CasesPage() {
  const user = await requireUser();
  if (!user.canCases) redirect("/inbox");

  const shopIds = await accessibleShopIds(user);
  const rows = await listCases(shopIds);
  const report = reportFrom(rows);
  const now = Date.now();

  const sorted = [...rows].sort((a, b) => {
    const ao = OPEN_STATUS.has((a.status || "").toUpperCase()) ? 0 : 1;
    const bo = OPEN_STATUS.has((b.status || "").toUpperCase()) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const at = a.dueBy ? a.dueBy.getTime() : Infinity;
    const bt = b.dueBy ? b.dueBy.getTime() : Infinity;
    return at - bt;
  });

  const recovered = Object.entries(report.recovered)
    .map(([cur, amt]) => euro(amt, cur))
    .join(" · ") || "—";
  const decided = report.won + report.lost;
  const winRate = decided ? Math.round((report.won / decided) * 100) : null;

  function badge(row: CaseRow) {
    const u = urgency(row.dueBy, now);
    return (
      <span className={`due ${URGENCY_CLASS[u.level]}`}>
        <span className="due-dot" /> {countdownLabel(u.hoursLeft)}
      </span>
    );
  }

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Fälle</h1>
        <SyncDisputesButton />
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Offen</div><div className="v">{report.open}</div></div>
          <div className="rstat"><div className="k">Gewonnen</div><div className="v">{report.won}</div></div>
          <div className="rstat"><div className="k">Verloren</div><div className="v">{report.lost}</div></div>
          <div className="rstat"><div className="k">Win-Rate</div><div className="v">{winRate == null ? "—" : `${winRate}%`}</div></div>
          <div className="rstat"><div className="k">Zurückgeholt</div><div className="v">{recovered}</div></div>
        </div>
      </section>

      <section className="card">
        <h2>Offene &amp; vergangene Fälle</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Nach Frist sortiert (dringendste oben). Shopify-Payments: voll bearbeitbar. PayPal folgt (read-only).
        </p>
        <table>
          <thead>
            <tr>
              <th>Frist</th>
              <th>Shop</th>
              <th>Quelle</th>
              <th>Betrag</th>
              <th>Grund</th>
              <th>Status</th>
              <th>Kunde / Bestellung</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id}>
                <td>{badge(r)}</td>
                <td>{r.shopName}</td>
                <td><span className="sbadge">{r.source === "paypal" ? "PayPal" : "Shopify"}</span></td>
                <td>{r.amount ? euro(r.amount, r.currency || "EUR") : "—"}</td>
                <td>
                  <Link href={`/cases/${r.id}`}>{reasonInfo(r.reason).label}</Link>
                  {r.threadNumber && <span className="muted"> · 🎫 #{r.threadNumber}</span>}
                </td>
                <td>{statusLabel(r.status)}</td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {r.customerName || r.customerEmail || "—"}{r.orderName ? ` · ${r.orderName}` : ""}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Keine Fälle. „Disputes aktualisieren" holt offene Disputes aus Shopify
                  (benötigt den Scope <em>read_shopify_payments_disputes</em> im Token).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
