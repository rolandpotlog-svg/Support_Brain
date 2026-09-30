import Link from "next/link";
import { redirect } from "next/navigation";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { listCases, reportFrom, type CaseRow } from "@/server/disputes";
import { euro } from "@/lib/format";
import { countdownLabel, reasonInfo, statusLabel, urgency } from "@/lib/disputes/reasons";
import { paypalAdvice, stageLabel } from "@/lib/disputes/paypal-policy";
import { SyncDisputesButton } from "./sync-disputes-button";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { getActiveShopId } from "@/server/active-shop";

const URGENCY_CLASS: Record<string, string> = {
  overdue: "rose",
  urgent: "rose",
  soon: "amber",
  ok: "green",
  none: "muted",
};

const OPEN_STATUS = new Set(["NEEDS_RESPONSE", "UNDER_REVIEW"]);
const NONE = "00000000-0000-0000-0000-000000000000";

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ quelle?: string; bereich?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shops = await db
    .select({ id: schema.shops.id, name: schema.shops.name })
    .from(schema.shops)
    .where(and(inArray(schema.shops.id, accessible.length ? accessible : [NONE]), eq(schema.shops.active, true)));
  const activeShopId = await getActiveShopId(shops.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).cases) redirect("/inbox");

  // Trennung: standardmäßig nur der aktive Shop; „alle Shops“ = alle, für die der Nutzer Fälle sehen darf.
  const allShops = sp.bereich === "alle";
  const caseShops: string[] = [];
  if (allShops) {
    for (const s of shops) if ((await brandAccess(user, s.id)).cases) caseShops.push(s.id);
  }
  const shopIds = allShops ? caseShops : [activeShopId];

  const all = await listCases(shopIds);
  const hasPaypal = all.some((r) => r.source === "paypal");
  const quelle = sp.quelle ?? (hasPaypal ? "paypal" : "alle");
  const rows = quelle === "alle" ? all : all.filter((r) => (quelle === "paypal" ? r.source === "paypal" : r.source !== "paypal"));
  const report = reportFrom(rows);
  const now = Date.now();
  const lost90 = rows.filter((r) => (r.status || "").toUpperCase() === "LOST" && r.initiatedAt && now - r.initiatedAt.getTime() < 90 * 86_400_000).length;
  const unclear = rows.filter((r) => r.source === "paypal" && r.matchConfidence !== "sicher" && OPEN_STATUS.has((r.status || "").toUpperCase())).length;

  const sorted = [...rows].sort((a, b) => {
    const ao = OPEN_STATUS.has((a.status || "").toUpperCase()) ? 0 : 1;
    const bo = OPEN_STATUS.has((b.status || "").toUpperCase()) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const at = a.dueBy ? a.dueBy.getTime() : Infinity;
    const bt = b.dueBy ? b.dueBy.getTime() : Infinity;
    return at - bt;
  });

  const decided = report.won + report.lost;
  const winRate = decided ? Math.round((report.won / decided) * 100) : null;
  const href = (q: Partial<{ quelle: string; bereich: string }>) => {
    const p = new URLSearchParams({ quelle, ...(allShops ? { bereich: "alle" } : {}), ...q });
    if (p.get("bereich") === "shop") p.delete("bereich");
    return `/cases?${p.toString()}`;
  };

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
        <h1 style={{ margin: 0 }}>{quelle === "paypal" ? "PayPal-Fälle" : "Fälle"}</h1>
        <SyncDisputesButton />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {[
          ["paypal", "PayPal"],
          ["shopify", "Shopify Payments"],
          ["alle", "Alle Quellen"],
        ].map(([k, l]) => (
          <Link key={k} href={href({ quelle: k })} className={`fchip ${quelle === k ? "active" : ""}`}>{l}</Link>
        ))}
        <span style={{ width: 12 }} />
        <Link href={href({ bereich: "shop" })} className={`fchip ${!allShops ? "active" : ""}`}>Dieser Shop</Link>
        {shops.length > 1 && <Link href={href({ bereich: "alle" })} className={`fchip ${allShops ? "active" : ""}`}>Alle meine Shops</Link>}
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Offen</div><div className="v">{report.open}</div></div>
          <div className="rstat"><div className="k">Zuordnung prüfen</div><div className="v">{unclear}</div></div>
          <div className="rstat"><div className="k">Verloren (90 Tage)</div><div className="v">{lost90}</div></div>
          <div className="rstat"><div className="k">Gewonnen / Verloren</div><div className="v">{report.won} / {report.lost}</div></div>
          <div className="rstat"><div className="k">Win-Rate</div><div className="v">{winRate == null ? "—" : `${winRate}%`}</div></div>
        </div>
        {quelle !== "shopify" && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Jeder verlorene PayPal-Fall belastet das Verkäuferkonto. Ziel: offene Fälle schnell und kulant lösen, verteidigen nur mit klarem Beleg.
          </p>
        )}
      </section>

      <section className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Frist</th>
              {allShops && <th>Shop</th>}
              {quelle === "alle" && <th>Quelle</th>}
              <th>Betrag</th>
              <th>Grund</th>
              <th>Empfehlung</th>
              <th>Status</th>
              <th>Kunde / Bestellung</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const pp = r.source === "paypal";
              const open = OPEN_STATUS.has((r.status || "").toUpperCase());
              const adv = pp ? paypalAdvice({ amount: r.amount, reason: r.reason, stage: r.stage, matchConfidence: r.matchConfidence, facts: r.facts }) : null;
              return (
                <tr key={r.id}>
                  <td>{open ? badge(r) : <span className="muted">—</span>}</td>
                  {allShops && <td>{r.shopName}</td>}
                  {quelle === "alle" && <td><span className="sbadge">{pp ? "PayPal" : "Shopify"}</span></td>}
                  <td>{r.amount ? euro(r.amount, r.currency || "EUR") : "—"}</td>
                  <td>
                    <Link href={`/cases/${r.id}`}>{reasonInfo(r.reason).label}</Link>
                    {pp && <span className="muted" style={{ fontSize: 12 }}> · {stageLabel(r.stage)}</span>}
                    {r.threadNumber && <span className="muted"> · 🎫 #{r.threadNumber}</span>}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {adv && open ? (
                      <>
                        {adv.label}
                        {r.hasDraft && <span className="muted"> · ✓ Entwurf</span>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{statusLabel(r.status)}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {r.customerName || r.customerEmail || "—"}
                    {r.orderName ? ` · ${r.orderName}` : ""}
                    {pp && r.matchConfidence !== "sicher" && (
                      <span className="orderbadge warn" style={{ marginLeft: 6 }}>{r.matchConfidence === "wahrscheinlich" ? "≈ prüfen" : "⚠ Zuordnung"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  {quelle === "paypal"
                    ? "Keine PayPal-Fälle. Neue Fälle kommen automatisch alle 30 Minuten (PayPal-Zugang unter Admin → Shop → Zugang)."
                    : "Keine Fälle."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
