// Finance/Controlling — wöchentliches PnL-Dashboard (Repello). finance_access-geschützt.
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { CHANNELS } from "@/lib/finance/channels";
import { ShopSwitcher } from "../inbox/shop-switcher";
import { IngestButton } from "./ingest-button";
import { WeekInputs } from "./week-inputs";
import { PickoshipUpload } from "./pickoship-upload";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const roasFmt = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const pctFmt = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)} %`);
const AMPEL_COLOR: Record<string, string> = { rot: "#e5634d", gelb: "#d9a300", gruen: "#3fb950", neutral: "#9aa0ab" };

function Ampel({ a }: { a: string }) {
  return <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: AMPEL_COLOR[a] ?? "#999" }} title={a} />;
}

export default async function FinancePage() {
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).finance) redirect("/inbox");

  const report = await buildFinanceReport(activeShopId);
  const last: WeekRow | undefined = report.weeks[0];
  const ytd = report.ytd;
  const today = new Date().toISOString().slice(0, 10);

  const hasMarketing = report.weeks.some((w) => w.inputs.marketingCents > 0);
  const shippingPendingTotal = report.weeks.reduce((s, w) => s + w.shippingPending, 0);
  const incomplete = report.weeks.length > 0 && (!hasMarketing || shippingPendingTotal > 0);

  const inputWeeks = report.weeks.map((w) => ({
    weekStart: w.weekStart,
    label: w.label,
    values: {
      ...Object.fromEntries(CHANNELS.map((c) => [c, (w.marketingByChannel[c] ?? 0) / 100])),
      fix: w.inputs.fixkostenCents / 100,
      var: w.inputs.variableCents / 100,
    } as Record<string, number>,
  }));

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Finance · PnL</h1>
        <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/finance" />
      </div>

      {/* VAT-Falle erklären */}
      <section className="card" style={{ borderColor: "#d9a30055", background: "#d9a30011" }}>
        <strong>⚠ VAT-Falle:</strong>{" "}
        <span className="muted">
          Triple Whale / Meta zeigen ROAS auf <b>Bruttoumsatz inkl. 20 % USt</b>. Gesteuert wird gegen den
          <b> Brutto-Break-Even-ROAS</b> — ein Dashboard-ROAS, der „okay" aussieht, kann netto ein Verlust sein.
        </span>
      </section>

      {/* Unvollständige Daten -> klar kennzeichnen (sonst sieht alles fälschlich profitabel aus) */}
      {incomplete && (
        <section className="card" style={{ borderColor: "#e5634d55", background: "#e5634d11" }}>
          <strong>⚠ Unvollständige Daten — Zahlen noch nicht aussagekräftig.</strong>
          <ul className="esc-list" style={{ marginBottom: 0 }}>
            {!hasMarketing && <li>Kein <b>Marketing-Spend</b> erfasst → Margen erscheinen viel zu hoch, Ampel grau (neutral). Unten bei „Marketing &amp; Kosten erfassen" eintragen.</li>}
            {shippingPendingTotal > 0 && <li><b>{shippingPendingTotal}</b> Bestellungen ohne <b>Versanddaten</b> → Pickoship-Beleg(e) hochladen.</li>}
          </ul>
        </section>
      )}

      {/* KPI-Kacheln */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>YTD &amp; letzte Woche {last ? `(${last.label})` : ""}</h2>
        <div className="report">
          <div className="rstat"><div className="k">Nettoumsatz YTD</div><div className="v">{eur(ytd.nettoumsatzCents)}</div></div>
          <div className="rstat"><div className="k">Marketing YTD</div><div className="v">{eur(ytd.marketingCents)}</div></div>
          <div className="rstat"><div className="k">PnL YTD</div><div className="v" style={{ color: ytd.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(ytd.pnlCents)}</div></div>
          <div className="rstat"><div className="k">Marge YTD</div><div className="v">{pctFmt(ytd.margePct)}</div></div>
          <div className="rstat"><div className="k">Ist-ROAS YTD</div><div className="v">{roasFmt(ytd.roasGesamt)}</div></div>
          <div className="rstat"><div className="k">BE-ROAS YTD</div><div className="v">{roasFmt(ytd.beRoasGesamt)}</div></div>
          {last && <div className="rstat"><div className="k">Status letzte Woche</div><div className="v"><Ampel a={last.pnl.ampel} /></div></div>}
        </div>
      </section>

      {/* Daten ziehen */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Shopify-Daten aktualisieren</h2>
        <p className="muted" style={{ marginTop: 0 }}>Bestellungen (Umsatz, Steuer, Versand-Einnahme, Refunds) + Produktkosten (COGS nach Name).</p>
        <IngestButton shopId={activeShopId} defaultUntil={today} />
      </section>

      {/* Pickoship-Versand */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Versand (Pickoship-Beleg)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Wöchentliche Pickoship-Rechnung (PDF) hochladen → Versand je Order wird geparst und gegen die
          Rechnungssumme geprüft. Nach deiner Kontrolle verbuchen.
        </p>
        <PickoshipUpload shopId={activeShopId} />
      </section>

      {/* Wochen-Tabelle */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Wochen-PnL</h2>
        {report.weeks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Noch keine Daten — oben „Shopify-Daten ziehen".</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="fin-table">
              <thead>
                <tr>
                  <th>KW</th><th>Netto</th><th>Marketing</th><th>COGS</th><th>Versand</th><th>Fee</th>
                  <th>DB</th><th>PnL</th><th>Marge</th><th>ROAS</th><th>BE-ROAS</th><th>Ampel</th><th></th>
                </tr>
              </thead>
              <tbody>
                {report.weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <td><strong>{w.label}</strong><div className="muted" style={{ fontSize: 11 }}>{w.weekStart}</div></td>
                    <td>{eur(w.pnl.nettoumsatzCents)}</td>
                    <td>{eur(w.inputs.marketingCents)}</td>
                    <td>{eur(w.inputs.produktkostenCents)}</td>
                    <td>{eur(w.inputs.versandkostenCents)}</td>
                    <td>{eur(w.pnl.paymentFeeCents)}</td>
                    <td>{eur(w.pnl.deckungsbeitragCents)}</td>
                    <td style={{ color: w.pnl.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(w.pnl.pnlCents)}</td>
                    <td>{pctFmt(w.pnl.margePct)}</td>
                    <td>{roasFmt(w.pnl.roasGesamt)}</td>
                    <td>{roasFmt(w.pnl.beRoasGesamt)}</td>
                    <td><Ampel a={w.pnl.ampel} /></td>
                    <td style={{ fontSize: 11 }}>
                      {w.unmappedOrders > 0 && <span title="Bestellungen mit unbekanntem Produkt" style={{ color: AMPEL_COLOR.rot }}>⚠{w.unmappedOrders} </span>}
                      {w.shippingPending > 0 && <span className="muted" title="Orders ohne Versanddaten">📦{w.shippingPending}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Produkt = Shopify (exakt) · Versand = Pickoship (noch manuell, bis Anbindung steht) · ⚠ = unbekanntes Produkt (COGS prüfen) · 📦 = Versand pending.
        </p>
      </section>

      {/* Manuelle Eingaben */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Marketing &amp; Kosten erfassen</h2>
        <p className="muted" style={{ marginTop: 0 }}>Spend je Kanal + Fix-/Variable-Kosten pro Woche. PnL, BE-ROAS und Ampel rechnen automatisch nach.</p>
        <WeekInputs shopId={activeShopId} weeks={inputWeeks} />
      </section>
    </div>
  );
}
