// Finance/Controlling — wöchentliches PnL-Dashboard (Repello). finance_access-geschützt.
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { getCogsRateRows, getUnmappedTitles, getProductBreakdown } from "@/server/finance/cogs-rates";
import { loadAdsAccounts } from "@/server/finance/meta-ads";
import { loadGoogleAds } from "@/server/finance/google-ads";
import { CHANNELS } from "@/lib/finance/channels";
import { currentWeekStart, kwLabel, kwOfWeekStart, weekOf } from "@/lib/finance/week";
import { IngestButton } from "./ingest-button";
import { WeekInputs } from "./week-inputs";
import { PickoshipUpload } from "./pickoship-upload";
import { BlueprintUpload } from "./blueprint-upload";
import { LiveTicker } from "./live-ticker";
import { CogsEditor } from "./cogs-editor";
import { MetaAdsConnector } from "./meta-ads";
import { GoogleAdsConnector } from "./google-ads";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const roasFmt = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const pctFmt = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)} %`);
const AMPEL_COLOR: Record<string, string> = { rot: "#e5634d", gelb: "#d9a300", gruen: "#3fb950", neutral: "#9aa0ab" };

/** "25.05.–31.05.2026" aus dem Montags-Key. */
function weekRange(weekStart: string): string {
  const mon = new Date(`${weekStart}T00:00:00Z`);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(mon.getUTCDate())}.${p(mon.getUTCMonth() + 1)}.–${p(sun.getUTCDate())}.${p(sun.getUTCMonth() + 1)}.${sun.getUTCFullYear()}`;
}

function Ampel({ a }: { a: string }) {
  return <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: AMPEL_COLOR[a] ?? "#999" }} title={a} />;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
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
  const ytd = report.ytd;
  const today = new Date().toISOString().slice(0, 10);

  const cogsRows = (await getCogsRateRows(activeShopId)).map((r) => ({
    ...r,
    updatedAtISO: r.updatedAt ? r.updatedAt.toISOString() : null,
  }));
  const unmappedTitles = await getUnmappedTitles(activeShopId);
  const adsAccounts = await loadAdsAccounts(activeShopId);
  const googleAds = await loadGoogleAds(activeShopId);
  const adsSince = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);

  // Laufende Woche (aus heute) vs. letzte VOLLSTÄNDIGE Woche.
  const cw = currentWeekStart();
  const liveWeek: WeekRow | undefined = report.weeks.find((w) => w.weekStart === cw);
  const lastComplete: WeekRow | undefined = report.weeks.find((w) => w.weekStart < cw);

  // Woche im Detail: aus eingegebenem Datum -> Woche; sonst letzte vollständige Woche.
  const selectedWeekStart = dateParam ? weekOf(new Date(`${dateParam}T12:00:00Z`)).weekStart : lastComplete?.weekStart;
  const selectedWeek: WeekRow | undefined = report.weeks.find((w) => w.weekStart === selectedWeekStart);

  // Soll laut Shopify für die laufende Woche (Grundlage für Supplier-Abgleich).
  const sollBreakdown = await getProductBreakdown(activeShopId, cw);
  const sollWeekLabel = liveWeek?.label ?? kwLabel(kwOfWeekStart(cw));

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
      <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Finance · PnL <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>(Daten &amp; Setup)</span></h1>
        <a href="/finance/cockpit" className="btnlink primary">🪟 Zum Cockpit</a>
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

      {/* Live-Ticker: laufende Woche (unvollständig, aktualisiert sich automatisch) */}
      <section className="card" style={{ borderColor: "#e5634d55" }}>
        <div className="formhead" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>🔴 Aktuelle Woche · live {liveWeek ? `(${liveWeek.label})` : `(${kwLabel(kwOfWeekStart(cw))})`}</h2>
          <LiveTicker shopId={activeShopId} weekStart={cw} />
        </div>
        <div className="report">
          <div className="rstat"><div className="k">Bestellungen</div><div className="v">{liveWeek?.orderCount ?? 0}</div></div>
          <div className="rstat"><div className="k">Nettoumsatz</div><div className="v">{eur(liveWeek?.pnl.nettoumsatzCents ?? 0)}</div></div>
          <div className="rstat"><div className="k">COGS</div><div className="v">{eur(liveWeek?.inputs.produktkostenCents ?? 0)}</div></div>
          <div className="rstat"><div className="k">Marketing</div><div className="v">{eur(liveWeek?.inputs.marketingCents ?? 0)}</div></div>
          <div className="rstat"><div className="k">PnL (vorläufig)</div><div className="v" style={{ color: (liveWeek?.pnl.pnlCents ?? 0) < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(liveWeek?.pnl.pnlCents ?? 0)}</div></div>
        </div>
        <p className="muted" style={{ margin: "8px 0 0" }}>
          Läuft noch — <b>Marketing &amp; Versand der laufenden Woche meist noch nicht erfasst</b>, PnL daher vorläufig.
          Umsatz/Bestellungen kommen live aus Shopify.
        </p>
      </section>

      {/* KPI-Kacheln — letzte VOLLSTÄNDIGE Woche */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>YTD &amp; letzte vollständige Woche {lastComplete ? `(${lastComplete.label})` : ""}</h2>
        <div className="report">
          <div className="rstat"><div className="k">Nettoumsatz YTD</div><div className="v">{eur(ytd.nettoumsatzCents)}</div></div>
          <div className="rstat"><div className="k">Marketing YTD</div><div className="v">{eur(ytd.marketingCents)}</div></div>
          <div className="rstat"><div className="k">PnL YTD</div><div className="v" style={{ color: ytd.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(ytd.pnlCents)}</div></div>
          <div className="rstat"><div className="k">Marge YTD</div><div className="v">{pctFmt(ytd.margePct)}</div></div>
          <div className="rstat"><div className="k">Ist-ROAS YTD</div><div className="v">{roasFmt(ytd.roasGesamt)}</div></div>
          <div className="rstat"><div className="k">BE-ROAS YTD</div><div className="v">{roasFmt(ytd.beRoasGesamt)}</div></div>
          {lastComplete && <div className="rstat"><div className="k">Status {lastComplete.label}</div><div className="v"><Ampel a={lastComplete.pnl.ampel} /></div></div>}
        </div>
      </section>

      {/* Woche im Detail — beliebige Vergangenheit per Datum */}
      <section className="card">
        <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Woche im Detail{selectedWeek ? ` · ${selectedWeek.label}` : ""}</h2>
          <form method="get" className="srcrow" style={{ margin: 0, gap: 8, alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 13 }}>Datum:</span>
            <input
              type="date"
              name="date"
              defaultValue={selectedWeekStart ?? today}
              style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontSize: 13 }}
            />
            <button className="btnlink primary" type="submit">Anzeigen</button>
          </form>
        </div>
        {selectedWeek ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Woche {weekRange(selectedWeek.weekStart)} · {selectedWeek.orderCount} Bestellungen
            </p>
            <div className="report">
              <div className="rstat"><div className="k">Nettoumsatz</div><div className="v">{eur(selectedWeek.pnl.nettoumsatzCents)}</div></div>
              <div className="rstat"><div className="k">Marketing</div><div className="v">{eur(selectedWeek.inputs.marketingCents)}</div></div>
              <div className="rstat"><div className="k">COGS</div><div className="v">{eur(selectedWeek.inputs.produktkostenCents)}</div></div>
              <div className="rstat"><div className="k">Versand</div><div className="v">{eur(selectedWeek.inputs.versandkostenCents)}</div></div>
              <div className="rstat"><div className="k">Payment-Fee</div><div className="v">{eur(selectedWeek.pnl.paymentFeeCents)}</div></div>
              <div className="rstat"><div className="k">Deckungsbeitrag</div><div className="v">{eur(selectedWeek.pnl.deckungsbeitragCents)}</div></div>
              <div className="rstat"><div className="k">PnL</div><div className="v" style={{ color: selectedWeek.pnl.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(selectedWeek.pnl.pnlCents)}</div></div>
              <div className="rstat"><div className="k">Marge</div><div className="v">{pctFmt(selectedWeek.pnl.margePct)}</div></div>
              <div className="rstat"><div className="k">Ist-ROAS</div><div className="v">{roasFmt(selectedWeek.pnl.roasGesamt)}</div></div>
              <div className="rstat"><div className="k">BE-ROAS</div><div className="v">{roasFmt(selectedWeek.pnl.beRoasGesamt)}</div></div>
              <div className="rstat"><div className="k">Status</div><div className="v"><Ampel a={selectedWeek.pnl.ampel} /></div></div>
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Für dieses Datum gibt es noch keine Wochendaten.</p>
        )}
      </section>

      {/* Daten ziehen */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Shopify-Daten aktualisieren</h2>
        <p className="muted" style={{ marginTop: 0 }}>Bestellungen (Umsatz, Steuer, Versand-Einnahme, Refunds) + Produktkosten (COGS nach Name).</p>
        <IngestButton shopId={activeShopId} defaultUntil={today} />
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <p className="muted" style={{ marginTop: 0 }}>
            <b>Einmalig / Backfill:</b> bestehende PnL-Blueprint-Excel importieren — Marketing-Spend (alle Wochen)
            + historische Wochen, die der Shopify-Store nicht hat (KW09–17).
          </p>
          <BlueprintUpload shopId={activeShopId} />
        </div>
      </section>

      {/* Marketing automatisch aus Meta Ads */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Marketing automatisch (Meta Ads)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Werbeausgaben direkt aus Meta in die PnL ziehen — dann kein manuelles Eintragen mehr für die Meta-Kanäle.
          Du brauchst je Konto: <b>Werbekonto-ID</b> (act_…) + einen <b>Access-Token</b> mit <code>ads_read</code>.
        </p>
        <MetaAdsConnector shopId={activeShopId} accounts={adsAccounts} since={adsSince} until={today} />
      </section>

      {/* Marketing automatisch aus Google Ads */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Marketing automatisch (Google Ads)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Mehr Setup als Meta (einmalig): <b>Kunden-ID</b> · <b>OAuth Client-ID/Secret</b> (Google Cloud Console) ·
          <b> Developer-Token</b> (Google Ads API Center) · <b>Refresh-Token</b> (OAuth Playground, Scope <code>adwords</code>).
          Danach wochengenau automatisch in die PnL.
        </p>
        <GoogleAdsConnector shopId={activeShopId} cfg={googleAds} since={adsSince} until={today} />
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

      {/* Stückkosten (COGS) — editierbar + Plausi + Excel-Download */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Produktkosten / Stückkosten (COGS)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Basis-Stückkosten vom Supplier. Ändern sich die Preise → hier eintragen; <b>neue &amp; laufende</b> Wochen
          rechnen automatisch nach. <b>Historische Wochen (KW09–25 aus der Excel) bleiben unverändert.</b>{" "}
          Die Bundle-/Mengen-Logik (4× = 2 Bundles usw.) bleibt automatisch.
        </p>
        <CogsEditor shopId={activeShopId} rows={cogsRows} />

        {/* Soll laut Shopify (laufende Woche) — Basis für den Supplier-Abgleich */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <h3 style={{ margin: "0 0 4px" }}>Bestellt laut Shopify · {sollWeekLabel} (Soll)</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Was diese Woche wirklich bestellt wurde — diese Liste hältst du gegen die <b>wöchentliche Supplier-Rechnung</b>.
            <i> Den automatischen Abgleich (Rechnung hochladen → Differenz → Kontrolle) baue ich, sobald du mir ein Rechnungs-Beispiel schickst.</i>
          </p>
          {sollBreakdown.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Noch keine Bestellungen dieser Woche aus Shopify — oben im Live-Ticker „Jetzt aktualisieren".</p>
          ) : (
            <table className="fin-table">
              <thead><tr><th>Produkt</th><th style={{ textAlign: "right" }}>Menge</th><th style={{ textAlign: "right" }}>Berechnete COGS</th></tr></thead>
              <tbody>
                {sollBreakdown.map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td style={{ textAlign: "right" }}>{b.units}</td>
                    <td style={{ textAlign: "right" }}>{eur(b.cogsCents)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td>Summe</td>
                  <td style={{ textAlign: "right" }}>{sollBreakdown.reduce((s, b) => s + b.units, 0)}</td>
                  <td style={{ textAlign: "right" }}>{eur(sollBreakdown.reduce((s, b) => s + b.cogsCents, 0))}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        {unmappedTitles.length > 0 && (
          <div className="card" style={{ marginTop: 14, borderColor: "#e5634d55", background: "#e5634d11" }}>
            <strong>⚠ Plausi-Check: {unmappedTitles.length} Produkt(e) ohne Kosten-Zuordnung</strong>
            <p className="muted" style={{ margin: "4px 0 8px" }}>
              Diese Artikel kamen in echten Bestellungen vor, haben aber keine Stückkost (COGS = 0 angenommen).
              Supplier-Kosten ergänzen bzw. Mapping melden:
            </p>
            <ul className="esc-list" style={{ marginBottom: 0 }}>
              {unmappedTitles.map((t) => (
                <li key={t.title}><b>{t.title}</b> <span className="muted">· {t.count}×</span></li>
              ))}
            </ul>
          </div>
        )}
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
