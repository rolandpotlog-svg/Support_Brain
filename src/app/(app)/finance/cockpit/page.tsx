// Finance-Cockpit (Landing): Zeitfenster (Heute/7 Tage/KW) + Ampel/GAP-Urteil +
// Headline-Kennzahlen + GuV-Wasserfall (nur Wochen). Liest die bestehende Engine.
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { getWindowMetrics } from "@/server/finance/metrics";
import { loadAdsAccounts } from "@/server/finance/meta-ads";
import { loadGoogleAds } from "@/server/finance/google-ads";
import { cockpitMetrics, waterfallSteps } from "@/lib/finance/cockpit";
import { currentWeekStart, weekOf } from "@/lib/finance/week";
import { SyncButton } from "./sync-button";
import { FinanceChat } from "./finance-chat";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const eur2 = (c: number) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (c: number) => `${c >= 0 ? "+" : "−"}${eur(Math.abs(c))}`;
const roasFmt = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const pctFmt = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)} %`);
const AMPEL_COLOR: Record<string, string> = { rot: "#e5634d", gelb: "#d9a300", gruen: "#3fb950", neutral: "#9aa0ab" };
const AMPEL_WORD: Record<string, string> = { rot: "ROT — fixen", gelb: "GELB — beobachten", gruen: "GRÜN — skalieren", neutral: "NEUTRAL — Spend fehlt" };

const viennaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(new Date());
const shiftDay = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const minDate = (a: string, b: string) => (a < b ? a : b);

function ago(d: Date): string {
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  return h < 24 ? `vor ${h} Std` : `vor ${Math.round(h / 24)} Tg`;
}
function weekRange(weekStart: string): string {
  const mon = new Date(`${weekStart}T00:00:00Z`);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(mon.getUTCDate())}.${p(mon.getUTCMonth() + 1)}.–${p(sun.getUTCDate())}.${p(sun.getUTCMonth() + 1)}.${sun.getUTCFullYear()}`;
}
function Tile({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <div className="rstat">
      <div className="k">{k}</div>
      <div className="v" style={color ? { color } : undefined}>{v}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
function spendSub(byChannel: Record<string, number>): string {
  return Object.entries(byChannel).filter(([, c]) => c > 0)
    .map(([ch, c]) => `${ch}: ${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })}€`).join(" · ");
}

function Tabs({ win }: { win: string }) {
  const tabs = [
    { id: "today", label: "Heute" },
    { id: "roll7", label: "7 Tage" },
    { id: "thisweek", label: "Diese KW" },
    { id: "lastweek", label: "Letzte KW" },
  ];
  return (
    <div className="srcrow" style={{ margin: 0, gap: 6 }}>
      {tabs.map((t) => (
        <Link key={t.id} href={`/finance/cockpit?win=${t.id}`} className="btnlink" style={win === t.id ? { background: "var(--accent)", color: "#fff" } : undefined}>{t.label}</Link>
      ))}
    </div>
  );
}

export default async function CockpitPage({ searchParams }: { searchParams: Promise<{ week?: string; win?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true))).orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).finance) redirect("/inbox");

  const report = await buildFinanceReport(activeShopId);
  const cw = currentWeekStart();
  const lastComplete = report.weeks.find((w) => w.weekStart < cw);
  const win = sp.week ? "" : (sp.win ?? "lastweek");
  const isDaily = win === "today" || win === "roll7";

  // ---------- TAGESANSICHT (Heute / Rolling-7) — kein Profit ----------
  if (isDaily) {
    const todayV = viennaToday();
    const since = win === "today" ? todayV : shiftDay(todayV, -6);
    const wm = await getWindowMetrics(activeShopId, since, todayV);
    const label = win === "today" ? "Heute" : "Rolling 7 Tage";
    return (
      <div className="adminwrap">
        <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h1 style={{ margin: 0 }}>Finance · Cockpit</h1>
          <div className="srcrow" style={{ margin: 0, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Tabs win={win} />
            <SyncButton shopId={activeShopId} since={since} until={todayV} />
            <Link href="/finance" className="btnlink">⚙ Daten &amp; Setup</Link>
          </div>
        </div>
        <section className="card" style={{ borderColor: "#6f8cff55" }}>
          <h2 style={{ marginTop: 0 }}>{label} <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· {since === todayV ? since : `${since} – ${todayV}`} · vorläufig</span></h2>
          <div className="report">
            <Tile k="Bestellungen" v={String(wm.orders)} />
            <Tile k="Bruttoumsatz" v={eur(wm.bruttoCents)} />
            <Tile k="Nettoumsatz" v={eur(wm.nettoCents)} sub={`Gesamt ${eur(wm.gesamtCents)} (TW-Basis)`} />
            <Tile k="Marketing (Spend)" v={eur(wm.spendCents)} sub={spendSub(wm.spendByChannel)} />
            <Tile k="Blended-ROAS" v={roasFmt(wm.roasGesamt)} sub="Gesamtumsatz / Spend" />
            <Tile k="AOV (brutto)" v={wm.orders > 0 ? eur2(Math.round(wm.bruttoCents / wm.orders)) : "—"} />
          </div>
          <p className="muted" style={{ margin: "10px 0 0" }}>
            <b>Kein Tagesprofit:</b> Refund- &amp; Versand-Lag machen ihn unzuverlässig — Profit gibt es nur je abgeschlossener Woche.
            Tagesansicht ist für <b>Pacing &amp; Anomalien</b> (Spend/Orders/Umsatz/ROAS).
          </p>
          {wm.spendMissing && (
            <p className="bad-text" style={{ margin: "6px 0 0", fontSize: 13 }}>⚠ Bestellungen, aber kein Marketing-Spend im Zeitraum — „Jetzt synchronisieren" oder Ads-Verbindung prüfen.</p>
          )}
        </section>
        <FinanceChat shopId={activeShopId} />
      </div>
    );
  }

  // ---------- WOCHENANSICHT (Diese KW / Letzte KW / einzelne KW) ----------
  let targetStart: string | undefined;
  if (sp.week) targetStart = weekOf(new Date(`${sp.week}T12:00:00Z`)).weekStart;
  else if (win === "thisweek") targetStart = cw;
  else targetStart = lastComplete?.weekStart;
  const sel: WeekRow | undefined = report.weeks.find((w) => w.weekStart === targetStart) ?? lastComplete;
  const prior: WeekRow | undefined = sel ? report.weeks[report.weeks.findIndex((w) => w.weekStart === sel.weekStart) + 1] : undefined;

  const header = (
    <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <h1 style={{ margin: 0 }}>Finance · Cockpit</h1>
      <div className="srcrow" style={{ margin: 0, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Tabs win={win} />
        <form method="get" style={{ margin: 0 }}>
          <select name="week" defaultValue={sel?.weekStart ?? ""} className="shopswitch" style={{ padding: "5px 8px" }} aria-label="Woche">
            {report.weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>{w.label}</option>)}
          </select>
        </form>
        {sel && <SyncButton shopId={activeShopId} since={sel.weekStart} until={minDate(shiftDay(sel.weekStart, 6), viennaToday())} />}
        <Link href="/finance" className="btnlink">⚙ Daten &amp; Setup</Link>
      </div>
    </div>
  );

  if (!sel) {
    return <div className="adminwrap">{header}<section className="card"><p className="muted" style={{ margin: 0 }}>Noch keine Wochendaten.</p></section></div>;
  }

  const m = cockpitMetrics(sel.inputs, sel.pnl, sel.orderCount);
  const pm = prior ? cockpitMetrics(prior.inputs, prior.pnl, prior.orderCount) : null;
  const color = AMPEL_COLOR[m.ampel];
  const isLive = sel.weekStart >= cw;
  const steps = waterfallSteps(sel.inputs, sel.pnl);
  const maxAbs = Math.max(...steps.map((s) => Math.abs(s.cents)), 1);

  // Datenlage
  const ingestRow = await db.select({ last: sql<string | null>`max(ingested_at)` }).from(schema.financeOrder)
    .where(and(eq(schema.financeOrder.shopId, activeShopId), eq(schema.financeOrder.weekStart, sel.weekStart)));
  const lastIngest = ingestRow[0]?.last ? new Date(ingestRow[0].last) : null;
  const metaConfigured = (await loadAdsAccounts(activeShopId)).some((a) => a.configured);
  const googleConfigured = (await loadGoogleAds(activeShopId)).configured;
  const ch = sel.marketingByChannel;
  const issues: { warn: boolean; text: string }[] = [];
  if (m.spendCents === 0) issues.push({ warn: true, text: "Kein Marketing-Spend erfasst → Ampel neutral, Profit nicht aussagekräftig." });
  else {
    if (metaConfigured && (ch.meta ?? 0) + (ch.meta_garten ?? 0) === 0) issues.push({ warn: true, text: "Meta verbunden, aber kein Spend in dieser Woche — bitte Werbeausgaben holen." });
    if (googleConfigured && (ch.google ?? 0) === 0) issues.push({ warn: true, text: "Google verbunden, aber kein Spend in dieser Woche." });
    if (!googleConfigured && (ch.google ?? 0) === 0) issues.push({ warn: false, text: "Google-Spend noch nicht dabei (nicht verbunden) → Marketing/ROAS unvollständig." });
  }
  if (sel.shippingPending > 0) issues.push({ warn: true, text: `${sel.shippingPending} Bestellung(en) ohne Versandkosten → Lieferung unvollständig, PnL erscheint zu gut.` });
  if (sel.unmappedOrders > 0) issues.push({ warn: true, text: `${sel.unmappedOrders} Bestellung(en) mit unbekanntem Produkt → COGS evtl. zu niedrig.` });
  if (sel.inputs.fixkostenCents === 0) issues.push({ warn: false, text: "Fixkosten nicht erfasst → Profit = DB nach Werbung." });
  const hasWarn = issues.some((i) => i.warn);

  return (
    <div className="adminwrap">
      {header}

      <section className="card" style={{ borderColor: `${color}66`, background: `${color}0f` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: color, flex: "0 0 auto", boxShadow: `0 0 0 5px ${color}33` }} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{sel.label} {isLive && <span style={{ fontSize: 13, color: "var(--muted)" }}>· läuft (vorläufig)</span>}: {AMPEL_WORD[m.ampel]}</div>
            <div className="muted" style={{ marginTop: 2 }}>
              {weekRange(sel.weekStart)} · PnL <b style={{ color: m.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{signed(m.profitCents)}</b>
              {" · "}ROAS <b>{roasFmt(m.blendedRoas)}</b> vs. BE <b>{roasFmt(m.beRoas)}</b>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 12 }}>GAP (ROAS − BE)</div>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{m.gap == null ? "—" : (m.gap >= 0 ? "+" : "−") + Math.abs(m.gap).toFixed(2)}</div>
          </div>
        </div>
      </section>

      {issues.length > 0 ? (
        <section className="card" style={{ borderColor: hasWarn ? "#d9a30088" : "var(--border)", background: hasWarn ? "#d9a30010" : undefined }}>
          <strong>{hasWarn ? "⚠ Datenlage unvollständig — Zahlen vorläufig:" : "ℹ Hinweise zur Datenlage:"}</strong>
          <ul className="esc-list" style={{ margin: "6px 0 0" }}>{issues.map((i, k) => <li key={k}>{i.warn ? "⚠" : "ℹ"} {i.text}</li>)}</ul>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Shopify-Stand: {lastIngest ? ago(lastIngest) : "—"} · {sel.orderCount} Bestellungen erfasst.</p>
        </section>
      ) : (
        <p className="muted" style={{ margin: "-4px 0 0", fontSize: 13 }}>✓ Datenlage vollständig (Marketing, Versand, Produkt){lastIngest ? ` · Shopify-Stand ${ago(lastIngest)}` : ""}.</p>
      )}

      <section className="card">
        <div className="report">
          <Tile k="Nettoumsatz" v={eur(m.nettoCents)} sub={pm ? `${signed(m.nettoCents - pm.nettoCents)} vs. Vorwoche` : undefined} />
          <Tile k="DB nach Werbung" v={eur(m.dbNachWerbungCents)} color={m.dbNachWerbungCents < 0 ? AMPEL_COLOR.rot : undefined} sub={pm ? signed(m.dbNachWerbungCents - pm.dbNachWerbungCents) : undefined} />
          <Tile k="Profit (nach Fix)" v={eur(m.profitCents)} color={m.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen} sub={`Marge ${pctFmt(m.margePct)}`} />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Hebel</h2>
        <div className="report">
          <Tile k="Marketing (Spend)" v={eur(m.spendCents)} sub={spendSub(sel.marketingByChannel)} />
          <Tile k="Rabattquote" v={pctFmt(m.rabattquote)} color={(m.rabattquote ?? 0) > 0.25 ? AMPEL_COLOR.rot : undefined} />
          <Tile k="Retourenquote" v={pctFmt(m.retourenquote)} />
          <Tile k="AOV (brutto)" v={m.aovCents == null ? "—" : eur2(m.aovCents)} />
          <Tile k="COGS %" v={pctFmt(m.cogsPct)} />
          <Tile k="Versand %" v={pctFmt(m.versandPct)} />
          <Tile k="DB-Marge" v={pctFmt(m.dbMargePct)} />
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>GuV-Wasserfall · {sel.label}</h2>
        <table className="fin-table">
          <tbody>
            {steps.map((s) => {
              const w = Math.round((Math.abs(s.cents) / maxAbs) * 100);
              return (
                <tr key={s.label} style={{ fontWeight: s.kind === "result" || s.kind === "subtotal" ? 700 : 400, background: s.kind === "result" ? `${AMPEL_COLOR[s.cents < 0 ? "rot" : "gruen"]}14` : undefined }}>
                  <td style={{ width: "38%" }}>{s.label}</td>
                  <td style={{ width: "30%" }}><div style={{ height: 10, background: "var(--panel-2)", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${w}%`, height: "100%", background: s.cents < 0 ? AMPEL_COLOR.rot : "#3fb95066" }} /></div></td>
                  <td style={{ textAlign: "right", width: "18%", color: s.cents < 0 ? AMPEL_COLOR.rot : "var(--text)" }}>{signed(s.cents)}</td>
                  <td style={{ textAlign: "right", width: "14%" }} className="muted">{pctFmt(s.pctOfNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>% jeweils vom Nettoumsatz.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Wochen-Historie</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="fin-table">
            <thead><tr><th>KW</th><th>Netto</th><th>Spend</th><th>ROAS</th><th>BE-ROAS</th><th>PnL</th><th>Ampel</th></tr></thead>
            <tbody>
              {report.weeks.map((w) => (
                <tr key={w.weekStart} style={w.weekStart === sel.weekStart ? { background: "var(--panel-2)", fontWeight: 700 } : undefined}>
                  <td><Link href={`/finance/cockpit?week=${w.weekStart}`} className="btnlink" style={{ fontWeight: 700 }}>{w.label}</Link></td>
                  <td>{eur(w.pnl.nettoumsatzCents)}</td>
                  <td>{eur(w.inputs.marketingCents)}</td>
                  <td>{roasFmt(w.pnl.roasGesamt)}</td>
                  <td>{roasFmt(w.pnl.beRoasGesamt)}</td>
                  <td style={{ color: w.pnl.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(w.pnl.pnlCents)}</td>
                  <td><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: AMPEL_COLOR[w.pnl.ampel] }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FinanceChat shopId={activeShopId} />
    </div>
  );
}
