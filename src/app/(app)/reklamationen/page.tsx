// Supplier-Reklamationen: defekte Artikel erfassen + Auswertung (Defekte je Produkt,
// Status, Monatssumme/Gutschrift). returns-Cap-geschützt.
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { getClaimsOverview, CLAIM_STATUS_LABEL, CLAIM_STATUSES } from "@/server/claims/report";
import { getMonthlyDefectReport } from "@/server/claims/monthly";
import { ClaimForm } from "./claim-form";
import { ClaimActions } from "./claim-actions";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dt = (d: Date) => new Date(d).toLocaleDateString("de-DE");

export default async function ReklamationenPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; order?: string; qty?: string; source?: string; month?: string }>;
}) {
  const sp = await searchParams;
  const prefill = sp.product
    ? {
        product: sp.product,
        orderName: sp.order,
        quantity: sp.qty,
        source: (sp.source === "wareneingang" ? "wareneingang" : "manuell") as "manuell" | "wareneingang",
      }
    : undefined;
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true))).orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).returns) redirect("/inbox");

  const ov = await getClaimsOverview(activeShopId);
  const monthly = await getMonthlyDefectReport(activeShopId, sp.month);

  return (
    <div className="adminwrap">
      <div className="formhead"><h1 style={{ margin: 0 }}>Reklamationen · Supplier</h1></div>

      {/* Auswertung */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Auswertung · {ov.month.label}</h2>
        <div className="report">
          <div className="rstat"><div className="k">Reklamationen (Monat)</div><div className="v">{ov.month.claims}</div></div>
          <div className="rstat"><div className="k">Defekte Stück (Monat)</div><div className="v">{ov.month.units}</div></div>
          <div className="rstat"><div className="k">Offen (Stück)</div><div className="v">{ov.month.openUnits}</div></div>
          <div className="rstat"><div className="k">Gutschrift (Monat)</div><div className="v">{eur(ov.month.creditCents)}</div></div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12 }}>
          <div style={{ flex: "1 1 280px" }}>
            <h3 style={{ margin: "0 0 6px" }}>Defekte je Produkt (gesamt)</h3>
            {ov.byProduct.length === 0 ? <p className="muted" style={{ margin: 0 }}>Noch keine Daten.</p> : (
              <table className="fin-table">
                <thead><tr><th>Produkt</th><th style={{ textAlign: "right" }}>Fälle</th><th style={{ textAlign: "right" }}>Stück</th><th style={{ textAlign: "right" }}>Gutschrift</th></tr></thead>
                <tbody>
                  {ov.byProduct.map((p) => (
                    <tr key={p.product}><td>{p.product}</td><td style={{ textAlign: "right" }}>{p.claims}</td><td style={{ textAlign: "right" }}>{p.units}</td><td style={{ textAlign: "right" }}>{eur(p.creditCents)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ flex: "0 1 220px" }}>
            <h3 style={{ margin: "0 0 6px" }}>Status</h3>
            <ul className="esc-list" style={{ margin: 0 }}>
              {CLAIM_STATUSES.map((s) => (
                <li key={s}>{CLAIM_STATUS_LABEL[s]}: <strong>{ov.byStatus[s] ?? 0}</strong></li>
              ))}
            </ul>
          </div>
        </div>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
          📋 <b>Monats-Report</b> (welche Artikel defekt, wie viele → Gutschrift-Anfrage an den Supplier) folgt als automatischer Report.
          Jede neue Reklamation wird zudem als <b>Trello-Karte</b> für den Supplier angelegt (sobald Trello verbunden ist).
        </p>
      </section>

      {/* Monats-Defekt-Report (Gutschrift-Anfrage an Supplier) */}
      <section className="card">
        <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Monats-Defekt-Report</h2>
          <form method="get" className="srcrow" style={{ margin: 0, alignItems: "center", gap: 8 }}>
            <select name="month" defaultValue={monthly.month} className="shopswitch" style={{ padding: "5px 8px" }}>
              {monthly.availableMonths.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <button className="btnlink" type="submit">Anzeigen</button>
            <a className="btnlink" href={`/reklamationen/report-export?shop=${activeShopId}&month=${monthly.month}`}>⬇ Excel</a>
          </form>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Defekte Artikel im <b>{monthly.label}</b> → <b>Gutschrift-Anfrage</b> an den Supplier (defekte Stück × Stückkost).
        </p>
        {monthly.rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Keine Reklamationen in diesem Monat.</p>
        ) : (
          <table className="fin-table">
            <thead><tr><th>Produkt</th><th style={{ textAlign: "right" }}>Fälle</th><th style={{ textAlign: "right" }}>Defekte Stück</th><th style={{ textAlign: "right" }}>Stückkost</th><th style={{ textAlign: "right" }}>Gutschrift angefragt</th><th style={{ textAlign: "right" }}>erhalten</th></tr></thead>
            <tbody>
              {monthly.rows.map((r) => (
                <tr key={r.product}>
                  <td>{r.product}</td>
                  <td style={{ textAlign: "right" }}>{r.claims}</td>
                  <td style={{ textAlign: "right" }}>{r.units}</td>
                  <td style={{ textAlign: "right" }}>{r.unitCostCents > 0 ? eur(r.unitCostCents) : "—"}</td>
                  <td style={{ textAlign: "right" }}>{eur(r.requestedCents)}</td>
                  <td style={{ textAlign: "right" }}>{eur(r.receivedCents)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Summe</td>
                <td style={{ textAlign: "right" }}>{monthly.totals.claims}</td>
                <td style={{ textAlign: "right" }}>{monthly.totals.units}</td>
                <td></td>
                <td style={{ textAlign: "right" }}>{eur(monthly.totals.requestedCents)}</td>
                <td style={{ textAlign: "right" }}>{eur(monthly.totals.receivedCents)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
          Sobald Trello verbunden ist, wird dieser Report monatlich automatisch als Karte/Checkliste im Supplier-Board erstellt.
        </p>
      </section>

      {/* Anlegen */}
      <section className="card" style={prefill ? { borderColor: "#d9a30088" } : undefined}>
        <h2 style={{ marginTop: 0 }}>Neue Reklamation</h2>
        {prefill && (
          <p className="muted" style={{ marginTop: 0 }}>
            ↩ Vorausgefüllt aus dem <b>Wareneingang</b>{prefill.orderName ? ` (${prefill.orderName})` : ""} — Defekt-Grund ergänzen &amp; anlegen.
          </p>
        )}
        <ClaimForm shopId={activeShopId} initial={prefill} />
      </section>

      {/* Liste */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Alle Reklamationen ({ov.claims.length})</h2>
        {ov.claims.length === 0 ? <p className="muted" style={{ margin: 0 }}>Noch keine Reklamationen.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="fin-table">
              <thead><tr><th>Datum</th><th>Artikel</th><th style={{ textAlign: "right" }}>Menge</th><th>Bestellung</th><th>Defekt</th><th>Status</th></tr></thead>
              <tbody>
                {ov.claims.map((c) => (
                  <tr key={c.id}>
                    <td className="muted">{dt(c.createdAt)}</td>
                    <td><b>{c.productLabel}</b>{c.sku ? <span className="muted"> · {c.sku}</span> : null}</td>
                    <td style={{ textAlign: "right" }}>{c.quantity}</td>
                    <td className="muted">{c.orderName ?? "—"}</td>
                    <td style={{ maxWidth: 280 }}>{c.reason}</td>
                    <td><ClaimActions claimId={c.id} status={c.status} creditCents={c.creditCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
