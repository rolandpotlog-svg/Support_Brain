// Finance · Daten & Setup — die Zahlen/Ampel leben im Cockpit (/finance/cockpit).
// Diese Seite gruppiert die Einrichtung in Tabs: Daten holen · Stückkosten · Eingaben.
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { buildFinanceReport } from "@/server/finance/report";
import { getCogsRateRows, getUnmappedTitles, getProductBreakdown } from "@/server/finance/cogs-rates";
import { loadAdsAccounts } from "@/server/finance/meta-ads";
import { loadGoogleAds } from "@/server/finance/google-ads";
import { CHANNELS } from "@/lib/finance/channels";
import { currentWeekStart, kwLabel, kwOfWeekStart } from "@/lib/finance/week";
import { IngestButton } from "./ingest-button";
import { WeekCostGrid } from "./week-cost-grid";
import { PickoshipUpload } from "./pickoship-upload";
import { BlueprintUpload } from "./blueprint-upload";
import { CogsEditor } from "./cogs-editor";
import { MetaAdsConnector } from "./meta-ads";
import { GoogleAdsConnector } from "./google-ads";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;

const TABS = [
  { id: "daten", label: "🔄 Daten holen" },
  { id: "cogs", label: "📦 Stückkosten" },
  { id: "eingaben", label: "✏️ Eingaben" },
];

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.id === tabParam) ? tabParam! : "daten";

  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true))).orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).finance) redirect("/inbox");

  const report = await buildFinanceReport(activeShopId);
  const today = new Date().toISOString().slice(0, 10);
  const cw = currentWeekStart();
  const adsSince = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);

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

  // Nur für die aktiven Tabs laden.
  const cogsRows = tab === "cogs" ? (await getCogsRateRows(activeShopId)).map((r) => ({ ...r, updatedAtISO: r.updatedAt ? r.updatedAt.toISOString() : null })) : [];
  const unmappedTitles = tab === "cogs" ? await getUnmappedTitles(activeShopId) : [];
  const sollBreakdown = tab === "cogs" ? await getProductBreakdown(activeShopId, cw) : [];
  const sollWeekLabel = kwLabel(kwOfWeekStart(cw));
  const adsAccounts = tab === "daten" ? await loadAdsAccounts(activeShopId) : [];
  const googleAds = tab === "daten" ? await loadGoogleAds(activeShopId) : { configured: false, customerId: "", loginCustomerId: "", clientId: "" };

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Finance · Daten &amp; Setup</h1>
        <a href="/finance/cockpit" className="btnlink primary">🪟 Zum Cockpit (Zahlen)</a>
      </div>

      {incomplete && (
        <section className="card" style={{ borderColor: "#e5634d55", background: "#e5634d11" }}>
          <strong>⚠ Unvollständige Daten — Zahlen im Cockpit noch nicht final.</strong>
          <ul className="esc-list" style={{ marginBottom: 0 }}>
            {!hasMarketing && <li>Kein <b>Marketing-Spend</b> erfasst → Tab <b>Daten holen</b> (Meta/Google) oder <b>Eingaben</b>.</li>}
            {shippingPendingTotal > 0 && <li><b>{shippingPendingTotal}</b> Bestellungen ohne <b>Versanddaten</b> → Tab <b>Daten holen</b> (Pickoship-Beleg).</li>}
          </ul>
        </section>
      )}

      {/* Tab-Leiste */}
      <div className="srcrow" style={{ gap: 6, marginBottom: 4 }}>
        {TABS.map((t) => (
          <Link key={t.id} href={`/finance?tab=${t.id}`} className="btnlink" style={tab === t.id ? { background: "var(--accent)", color: "#fff" } : undefined}>{t.label}</Link>
        ))}
      </div>

      {tab === "daten" && (
        <>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Shopify-Daten ziehen</h2>
            <p className="muted" style={{ marginTop: 0 }}>Bestellungen (Umsatz, Steuer, Versand-Einnahme, Refunds) + Produktkosten (COGS nach Name).</p>
            <IngestButton shopId={activeShopId} defaultUntil={today} />
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <p className="muted" style={{ marginTop: 0 }}><b>Einmalig / Backfill:</b> bestehende PnL-Blueprint-Excel importieren (Marketing + historische Wochen).</p>
              <BlueprintUpload shopId={activeShopId} />
              <div style={{ marginTop: 10 }}>
                <a href={`/finance/blueprint-export?shop=${activeShopId}`} className="btnlink primary">⬇ Aktuelle PnL als Excel (Blueprint-Format)</a>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Marketing automatisch (Meta Ads)</h2>
            <p className="muted" style={{ marginTop: 0 }}>Werbeausgaben direkt aus Meta in die PnL — je Konto <b>Werbekonto-ID</b> (act_…) + <b>Access-Token</b> (<code>ads_read</code>).</p>
            <MetaAdsConnector shopId={activeShopId} accounts={adsAccounts} since={adsSince} until={today} />
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Marketing automatisch (Google Ads)</h2>
            <p className="muted" style={{ marginTop: 0 }}>Mehr Setup (einmalig): Kunden-ID · OAuth Client-ID/Secret · Developer-Token · Refresh-Token (Scope <code>adwords</code>).</p>
            <GoogleAdsConnector shopId={activeShopId} cfg={googleAds} since={adsSince} until={today} />
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>Versand (Pickoship-Beleg)</h2>
            <p className="muted" style={{ marginTop: 0 }}>Wöchentliche Pickoship-Rechnung (PDF) hochladen → Versand + COGS gegen Rechnung & Shopify geprüft, dann verbuchen.</p>
            <PickoshipUpload shopId={activeShopId} />
          </section>

          <p className="muted" style={{ fontSize: 12 }}>
            ⚠ <b>VAT-Falle:</b> Triple Whale / Meta zeigen ROAS auf Brutto inkl. 20 % USt. Das Cockpit steuert gegen den <b>Brutto-Break-Even-ROAS</b>.
          </p>
        </>
      )}

      {tab === "cogs" && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Produktkosten / Stückkosten (COGS)</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Basis-Stückkosten vom Supplier. Ändern sich die Preise → hier eintragen; <b>neue &amp; laufende</b> Wochen rechnen automatisch nach.
            Historische Wochen (aus der Excel) bleiben unverändert. Bundle-/Mengen-Logik bleibt automatisch.
          </p>
          <CogsEditor shopId={activeShopId} rows={cogsRows} />

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h3 style={{ margin: "0 0 4px" }}>Bestellt laut Shopify · {sollWeekLabel} (Soll)</h3>
            <p className="muted" style={{ marginTop: 0 }}>Was diese Woche bestellt wurde — hältst du gegen die Supplier-Rechnung.</p>
            {sollBreakdown.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Noch keine Bestellungen dieser Woche aus Shopify.</p>
            ) : (
              <table className="fin-table">
                <thead><tr><th>Produkt</th><th style={{ textAlign: "right" }}>Menge</th><th style={{ textAlign: "right" }}>Berechnete COGS</th></tr></thead>
                <tbody>
                  {sollBreakdown.map((b) => (
                    <tr key={b.label}><td>{b.label}</td><td style={{ textAlign: "right" }}>{b.units}</td><td style={{ textAlign: "right" }}>{eur(b.cogsCents)}</td></tr>
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
              <ul className="esc-list" style={{ margin: "6px 0 0" }}>
                {unmappedTitles.map((t) => <li key={t.title}><b>{t.title}</b> <span className="muted">· {t.count}×</span></li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === "eingaben" && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Marketing &amp; Kosten erfassen</h2>
          <WeekCostGrid shopId={activeShopId} weeks={inputWeeks} />
        </section>
      )}
    </div>
  );
}
