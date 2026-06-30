// Finance-Cockpit (modernes SaaS-Dashboard): Hero-Status + KPI-Karten (Icon,
// Delta, Sparkline) + GuV-Wasserfall + Historie + Assistent. Liest die Engine.
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
import { computeWeekPnl, type WeekInputs } from "@/lib/finance/pnl";
import { currentWeekStart, weekOf } from "@/lib/finance/week";
import { SyncButton } from "./sync-button";
import { FinanceChat } from "./finance-chat";
import { Sparkline } from "./sparkline";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const eur2 = (c: number) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (c: number) => `${c >= 0 ? "+" : "−"}${eur(Math.abs(c))}`;
const roasFmt = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const pctFmt = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)} %`);
const AMPEL_COLOR: Record<string, string> = { rot: "#e5634d", gelb: "#d9a300", gruen: "#16a571", neutral: "#98a0af" };
const AMPEL_WORD: Record<string, string> = { rot: "ROT — fixen", gelb: "GELB — beobachten", gruen: "GRÜN — skalieren", neutral: "NEUTRAL — Spend fehlt" };
const C_GREEN = "var(--green)", C_BLUE = "var(--accent)", C_ROSE = "var(--tag-rose-fg)", C_AMBER = "var(--tag-amber-fg)";

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

type Pill = { cls: string; arrow: string; text: string } | null;
function pill(cur: number, prev: number | undefined, goodUp: boolean, kind: "eur" | "roas" | "pp"): Pill {
  if (prev === undefined || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return { cls: "flat", arrow: "→", text: "0" };
  const cls = (d > 0) === goodUp ? "up" : "down";
  const arrow = d > 0 ? "▲" : "▼";
  let text = "—";
  if (kind === "eur") text = prev !== 0 ? `${Math.round((Math.abs(d) / Math.abs(prev)) * 100)} %` : "—";
  else if (kind === "roas") text = Math.abs(d).toFixed(2);
  else text = `${(Math.abs(d) * 100).toFixed(1)} pp`;
  return { cls, arrow, text };
}

function spendSub(byChannel: Record<string, number>): string {
  return Object.entries(byChannel)
    .filter(([, c]) => c > 0)
    .map(([ch, c]) => `${ch}: ${Math.round(c / 100).toLocaleString("de-DE")}€`)
    .join(" · ");
}

function Kpi({ icon, label, value, valueColor, p, series, spark }: {
  icon: string; label: string; value: string; valueColor?: string; p: Pill; series: number[]; spark: string;
}) {
  return (
    <div className="kpi">
      <div className="kpi-top"><span className="kpi-chip">{icon}</span><span className="kpi-label">{label}</span></div>
      <div className="kpi-mid">
        <span className="kpi-val" style={valueColor ? { color: valueColor } : undefined}>{value}</span>
        {p && <span className={`kpi-delta ${p.cls}`}>{p.arrow} {p.text}</span>}
      </div>
      <Sparkline data={series} color={spark} />
    </div>
  );
}

function Tabs({ win }: { win: string }) {
  const tabs = [{ id: "today", label: "Heute" }, { id: "roll7", label: "7 Tage" }, { id: "thisweek", label: "Diese KW" }, { id: "lastweek", label: "Letzte KW" }, { id: "ytd", label: "YTD" }];
  return (
    <div className="seg">
      {tabs.map((t) => <Link key={t.id} href={`/finance/cockpit?win=${t.id}`} className={win === t.id ? "on" : ""}>{t.label}</Link>)}
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

  // ---------- TAGESANSICHT ----------
  if (isDaily) {
    const todayV = viennaToday();
    const since = win === "today" ? todayV : shiftDay(todayV, -6);
    const wm = await getWindowMetrics(activeShopId, since, todayV);
    const label = win === "today" ? "Heute" : "Rolling 7 Tage";
    return (
      <div className="adminwrap">
        <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h1 style={{ margin: 0 }}>Cockpit</h1>
          <div className="srcrow" style={{ margin: 0, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Tabs win={win} />
            <SyncButton shopId={activeShopId} since={since} until={todayV} />
            <Link href="/finance" className="btnlink">⚙ Setup</Link>
          </div>
        </div>
        <div className="alertbar" style={{ marginBottom: 4 }}>📅 <b>{label}</b> · {since === todayV ? since : `${since} – ${todayV}`} · vorläufig — <b>kein Tagesprofit</b> (Refund-/Versand-Lag); Tagesansicht = Pacing &amp; Anomalien.</div>
        <div className="dash-grid">
          <Kpi icon="🧾" label="Bestellungen" value={String(wm.orders)} p={null} series={[]} spark={C_BLUE} />
          <Kpi icon="💶" label="Bruttoumsatz" value={eur(wm.bruttoCents)} p={null} series={[]} spark={C_BLUE} />
          <Kpi icon="📈" label="Nettoumsatz" value={eur(wm.nettoCents)} p={null} series={[]} spark={C_GREEN} />
          <Kpi icon="📣" label="Marketing" value={eur(wm.spendCents)} p={null} series={[]} spark={C_AMBER} />
          <Kpi icon="🎯" label="Blended-ROAS" value={roasFmt(wm.roasGesamt)} p={null} series={[]} spark={C_GREEN} />
          <Kpi icon="🛒" label="AOV (brutto)" value={wm.orders > 0 ? eur2(Math.round(wm.bruttoCents / wm.orders)) : "—"} p={null} series={[]} spark={C_BLUE} />
        </div>
        {wm.spendMissing && <div className="alertbar warn" style={{ marginTop: 14 }}>⚠ Bestellungen, aber kein Marketing-Spend im Zeitraum — „Jetzt synchronisieren" oder Ads-Verbindung prüfen.</div>}
        <FinanceChat shopId={activeShopId} />
      </div>
    );
  }

  // ---------- YTD (alle abgeschlossenen Wochen) ----------
  if (win === "ytd") {
    const compl = report.weeks.filter((w) => w.weekStart < cw);
    const ascC = [...compl].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
    const sumI = (f: (w: WeekRow) => number) => compl.reduce((s, w) => s + f(w), 0);
    const agg: WeekInputs = {
      umsatzBruttoCents: sumI((w) => w.inputs.umsatzBruttoCents),
      rabatteCents: sumI((w) => w.inputs.rabatteCents),
      refundsCents: sumI((w) => w.inputs.refundsCents),
      versandEinnahmeCents: sumI((w) => w.inputs.versandEinnahmeCents),
      ustCents: sumI((w) => w.inputs.ustCents),
      marketingCents: sumI((w) => w.inputs.marketingCents),
      produktkostenCents: sumI((w) => w.inputs.produktkostenCents),
      versandkostenCents: sumI((w) => w.inputs.versandkostenCents),
      fixkostenCents: sumI((w) => w.inputs.fixkostenCents),
      variableCents: sumI((w) => w.inputs.variableCents),
    };
    const ypnl = computeWeekPnl(agg);
    const ym = cockpitMetrics(agg, ypnl, sumI((w) => w.orderCount));
    const yc = AMPEL_COLOR[ym.ampel];
    const ysteps = waterfallSteps(agg, ypnl);
    const ymax = Math.max(...ysteps.map((s) => Math.abs(s.cents)), 1);
    const chAgg: Record<string, number> = {};
    for (const w of compl) for (const [c, v] of Object.entries(w.marketingByChannel)) chAgg[c] = (chAgg[c] ?? 0) + v;
    const yr = compl[0] ? new Date(`${compl[0].weekStart}T00:00:00Z`).getUTCFullYear() : "";
    return (
      <div className="adminwrap">
        <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <h1 style={{ margin: 0 }}>Cockpit</h1>
          <div className="srcrow" style={{ margin: 0, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Tabs win="ytd" />
            <Link href="/finance" className="btnlink">⚙ Setup</Link>
          </div>
        </div>
        <div className="hero" style={{ borderColor: `${yc}55`, background: `linear-gradient(180deg, ${yc}14, transparent)` }}>
          <span className="hero-dot" style={{ background: yc, boxShadow: `0 0 0 5px ${yc}26` }} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="hero-title">YTD {yr} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>· {compl.length} abgeschlossene Wochen</span> · <span style={{ color: yc }}>{AMPEL_WORD[ym.ampel]}</span></div>
            <div className="hero-sub">PnL <b style={{ color: ym.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{signed(ym.profitCents)}</b> · ROAS <b>{roasFmt(ym.blendedRoas)}</b> vs. BE <b>{roasFmt(ym.beRoas)}</b> · Marge <b>{pctFmt(ym.margePct)}</b></div>
          </div>
          <div className="hero-gap">
            <div className="l">GAP (ROAS − BE)</div>
            <div className="n" style={{ color: yc }}>{ym.gap == null ? "—" : (ym.gap >= 0 ? "+" : "−") + Math.abs(ym.gap).toFixed(2)}</div>
          </div>
        </div>
        <div className="dash-grid">
          <Kpi icon="📈" label="Nettoumsatz YTD" value={eur(ym.nettoCents)} p={null} series={ascC.map((w) => w.pnl.nettoumsatzCents / 100)} spark={C_GREEN} />
          <Kpi icon="🧮" label="DB nach Werbung" value={eur(ym.dbNachWerbungCents)} valueColor={ym.dbNachWerbungCents < 0 ? AMPEL_COLOR.rot : undefined} p={null} series={ascC.map((w) => (w.pnl.deckungsbeitragCents - w.inputs.marketingCents) / 100)} spark={C_BLUE} />
          <Kpi icon="💰" label="Profit YTD" value={eur(ym.profitCents)} valueColor={ym.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen} p={null} series={ascC.map((w) => w.pnl.pnlCents / 100)} spark={ym.profitCents < 0 ? C_ROSE : C_GREEN} />
          <Kpi icon="📣" label="Marketing YTD" value={eur(ym.spendCents)} p={null} series={ascC.map((w) => w.inputs.marketingCents / 100)} spark={C_AMBER} />
          <Kpi icon="🎯" label="ROAS / BE" value={`${roasFmt(ym.blendedRoas)} / ${roasFmt(ym.beRoas)}`} p={null} series={ascC.map((w) => w.pnl.roasGesamt ?? 0)} spark={C_GREEN} />
          <Kpi icon="🏷️" label="Rabattquote" value={pctFmt(ym.rabattquote)} valueColor={(ym.rabattquote ?? 0) > 0.25 ? AMPEL_COLOR.rot : undefined} p={null} series={ascC.map((w) => (w.inputs.umsatzBruttoCents > 0 ? (w.inputs.rabatteCents / w.inputs.umsatzBruttoCents) * 100 : 0))} spark={C_ROSE} />
        </div>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>GuV-Wasserfall · YTD</h2>
          <table className="fin-table">
            <tbody>
              {ysteps.map((s) => {
                const w = Math.round((Math.abs(s.cents) / ymax) * 100);
                return (
                  <tr key={s.label} style={{ fontWeight: s.kind === "result" || s.kind === "subtotal" ? 700 : 400, background: s.kind === "result" ? `${AMPEL_COLOR[s.cents < 0 ? "rot" : "gruen"]}14` : undefined }}>
                    <td style={{ width: "38%" }}>{s.label}</td>
                    <td style={{ width: "30%" }}><div style={{ height: 9, background: "var(--panel-2)", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${w}%`, height: "100%", background: s.cents < 0 ? AMPEL_COLOR.rot : "#16a57155" }} /></div></td>
                    <td style={{ textAlign: "right", width: "18%", color: s.cents < 0 ? AMPEL_COLOR.rot : "var(--text)" }}>{signed(s.cents)}</td>
                    <td style={{ textAlign: "right", width: "14%" }} className="muted">{pctFmt(s.pctOfNet)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>Spend je Kanal: {spendSub(chAgg) || "—"}</p>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Wochen-Historie</h2>
          <div style={{ overflowX: "auto" }}>
            <table className="fin-table">
              <thead><tr><th>KW</th><th>Netto</th><th>Spend</th><th>ROAS</th><th>BE-ROAS</th><th>PnL</th><th>Ampel</th></tr></thead>
              <tbody>
                {report.weeks.map((w) => (
                  <tr key={w.weekStart}>
                    <td><Link href={`/finance/cockpit?week=${w.weekStart}`} className="btnlink" style={{ fontWeight: 700 }}>{w.label}</Link></td>
                    <td>{eur(w.pnl.nettoumsatzCents)}</td>
                    <td>{eur(w.inputs.marketingCents)}</td>
                    <td>{roasFmt(w.pnl.roasGesamt)}</td>
                    <td>{roasFmt(w.pnl.beRoasGesamt)}</td>
                    <td style={{ color: w.pnl.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(w.pnl.pnlCents)}</td>
                    <td><span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%", background: AMPEL_COLOR[w.pnl.ampel] }} /></td>
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

  // ---------- WOCHENANSICHT ----------
  let targetStart: string | undefined;
  if (sp.week) targetStart = weekOf(new Date(`${sp.week}T12:00:00Z`)).weekStart;
  else if (win === "thisweek") targetStart = cw;
  else targetStart = lastComplete?.weekStart;
  const sel: WeekRow | undefined = report.weeks.find((w) => w.weekStart === targetStart) ?? lastComplete;
  const selIdx = sel ? report.weeks.findIndex((w) => w.weekStart === sel.weekStart) : -1;
  const prior: WeekRow | undefined = selIdx >= 0 ? report.weeks[selIdx + 1] : undefined;

  const header = (
    <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <h1 style={{ margin: 0 }}>Cockpit</h1>
      <div className="srcrow" style={{ margin: 0, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Tabs win={win} />
        <form method="get" style={{ margin: 0 }}>
          <select name="week" defaultValue={sel?.weekStart ?? ""} className="shopswitch" style={{ padding: "6px 8px" }} aria-label="Woche">
            {report.weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>{w.label}</option>)}
          </select>
        </form>
        {sel && <SyncButton shopId={activeShopId} since={sel.weekStart} until={minDate(shiftDay(sel.weekStart, 6), viennaToday())} />}
        <Link href="/finance" className="btnlink">⚙ Setup</Link>
      </div>
    </div>
  );
  if (!sel) return <div className="adminwrap">{header}<section className="card"><p className="muted" style={{ margin: 0 }}>Noch keine Wochendaten.</p></section></div>;

  const m = cockpitMetrics(sel.inputs, sel.pnl, sel.orderCount);
  const pm = prior ? cockpitMetrics(prior.inputs, prior.pnl, prior.orderCount) : null;
  const color = AMPEL_COLOR[m.ampel];
  const isLive = sel.weekStart >= cw;
  const steps = waterfallSteps(sel.inputs, sel.pnl);
  const maxAbs = Math.max(...steps.map((s) => Math.abs(s.cents)), 1);

  // Sparkline-Serien (Wochen aufsteigend bis zur gewählten Woche)
  const asc = [...report.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)).filter((w) => w.weekStart <= sel.weekStart).slice(-12);
  const sNetto = asc.map((w) => w.pnl.nettoumsatzCents / 100);
  const sPnl = asc.map((w) => w.pnl.pnlCents / 100);
  const sDb = asc.map((w) => (w.pnl.deckungsbeitragCents - w.inputs.marketingCents) / 100);
  const sSpend = asc.map((w) => w.inputs.marketingCents / 100);
  const sRoas = asc.map((w) => w.pnl.roasGesamt ?? 0);
  const sRabatt = asc.map((w) => (w.inputs.umsatzBruttoCents > 0 ? (w.inputs.rabatteCents / w.inputs.umsatzBruttoCents) * 100 : 0));

  // Datenlage
  const ingestRow = await db.select({ last: sql<string | null>`max(ingested_at)` }).from(schema.financeOrder)
    .where(and(eq(schema.financeOrder.shopId, activeShopId), eq(schema.financeOrder.weekStart, sel.weekStart)));
  const lastIngest = ingestRow[0]?.last ? new Date(ingestRow[0].last) : null;
  const metaConfigured = (await loadAdsAccounts(activeShopId)).some((a) => a.configured);
  const googleConfigured = (await loadGoogleAds(activeShopId)).configured;
  const chh = sel.marketingByChannel;
  const issues: { warn: boolean; text: string }[] = [];
  if (m.spendCents === 0) issues.push({ warn: true, text: "Kein Marketing-Spend erfasst → Ampel neutral, Profit nicht aussagekräftig." });
  else {
    if (metaConfigured && (chh.meta ?? 0) + (chh.meta_garten ?? 0) === 0) issues.push({ warn: true, text: "Meta verbunden, aber kein Spend in dieser Woche — bitte synchronisieren." });
    if (googleConfigured && (chh.google ?? 0) === 0) issues.push({ warn: true, text: "Google verbunden, aber kein Spend in dieser Woche." });
    if (!googleConfigured && (chh.google ?? 0) === 0) issues.push({ warn: false, text: "Google-Spend noch nicht dabei (nicht verbunden) → Marketing/ROAS unvollständig." });
  }
  if (sel.shippingPending > 0) issues.push({ warn: true, text: `${sel.shippingPending} Bestellung(en) ohne Versandkosten → Lieferung unvollständig, PnL erscheint zu gut.` });
  if (sel.unmappedOrders > 0) issues.push({ warn: true, text: `${sel.unmappedOrders} Bestellung(en) mit unbekanntem Produkt → COGS evtl. zu niedrig.` });
  if (sel.orderCount > 0 && sel.cogsFromInvoice === 0) issues.push({ warn: false, text: "COGS = Shopify-Richtwert (Schätzung). Pickoship-Beleg hochladen → echte Supplier-COGS." });
  else if (sel.cogsRichtwert > 0) issues.push({ warn: false, text: `COGS: ${sel.cogsFromInvoice} Order(s) aus Supplier-Rechnung verbucht, ${sel.cogsRichtwert} noch Richtwert.` });
  if (sel.inputs.fixkostenCents === 0) issues.push({ warn: false, text: "Fixkosten nicht erfasst → Profit = DB nach Werbung." });
  const hasWarn = issues.some((i) => i.warn);

  return (
    <div className="adminwrap">
      {header}

      {/* Hero-Status */}
      <div className="hero" style={{ borderColor: `${color}55`, background: `linear-gradient(180deg, ${color}14, transparent)` }}>
        <span className="hero-dot" style={{ background: color, boxShadow: `0 0 0 5px ${color}26` }} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="hero-title">{sel.label} {isLive && <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>· läuft (vorläufig)</span>} · <span style={{ color }}>{AMPEL_WORD[m.ampel]}</span></div>
          <div className="hero-sub">{weekRange(sel.weekStart)} · PnL <b style={{ color: m.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{signed(m.profitCents)}</b> · ROAS <b>{roasFmt(m.blendedRoas)}</b> vs. BE <b>{roasFmt(m.beRoas)}</b></div>
        </div>
        <div className="hero-gap">
          <div className="l">GAP (ROAS − BE)</div>
          <div className="n" style={{ color }}>{m.gap == null ? "—" : (m.gap >= 0 ? "+" : "−") + Math.abs(m.gap).toFixed(2)}</div>
        </div>
      </div>

      {/* Datenlage */}
      {issues.length > 0 ? (
        <div className={`alertbar ${hasWarn ? "warn" : ""}`}>
          <b>{hasWarn ? "⚠ Datenlage unvollständig — vorläufig:" : "ℹ Hinweise:"}</b>
          <ul className="esc-list" style={{ margin: "5px 0 0" }}>{issues.map((i, k) => <li key={k}>{i.warn ? "⚠" : "ℹ"} {i.text}</li>)}</ul>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85 }}>Shopify-Stand: {lastIngest ? ago(lastIngest) : "—"} · {sel.orderCount} Bestellungen.</div>
        </div>
      ) : (
        <div className="alertbar ok">✓ Datenlage vollständig (Marketing, Versand, Produkt){lastIngest ? ` · Shopify-Stand ${ago(lastIngest)}` : ""}.</div>
      )}

      {/* KPI-Karten */}
      <div className="dash-grid">
        <Kpi icon="📈" label="Nettoumsatz" value={eur(m.nettoCents)} p={pill(m.nettoCents, pm?.nettoCents, true, "eur")} series={sNetto} spark={C_GREEN} />
        <Kpi icon="🧮" label="DB nach Werbung" value={eur(m.dbNachWerbungCents)} valueColor={m.dbNachWerbungCents < 0 ? AMPEL_COLOR.rot : undefined} p={pill(m.dbNachWerbungCents, pm?.dbNachWerbungCents, true, "eur")} series={sDb} spark={C_BLUE} />
        <Kpi icon="💰" label="Profit (nach Fix)" value={eur(m.profitCents)} valueColor={m.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen} p={pill(m.profitCents, pm?.profitCents, true, "eur")} series={sPnl} spark={m.profitCents < 0 ? C_ROSE : C_GREEN} />
        <Kpi icon="📣" label="Marketing (Spend)" value={eur(m.spendCents)} p={pill(m.spendCents, pm?.spendCents, false, "eur")} series={sSpend} spark={C_AMBER} />
        <Kpi icon="🎯" label="ROAS (vs BE)" value={`${roasFmt(m.blendedRoas)} / ${roasFmt(m.beRoas)}`} p={pill(m.blendedRoas ?? 0, pm?.blendedRoas ?? undefined, true, "roas")} series={sRoas} spark={C_GREEN} />
        <Kpi icon="🏷️" label="Rabattquote" value={pctFmt(m.rabattquote)} valueColor={(m.rabattquote ?? 0) > 0.25 ? AMPEL_COLOR.rot : undefined} p={pill(m.rabattquote ?? 0, pm?.rabattquote ?? undefined, false, "pp")} series={sRabatt} spark={C_ROSE} />
      </div>

      {/* GuV-Wasserfall */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>GuV-Wasserfall · {sel.label}</h2>
        <table className="fin-table">
          <tbody>
            {steps.map((s) => {
              const w = Math.round((Math.abs(s.cents) / maxAbs) * 100);
              return (
                <tr key={s.label} style={{ fontWeight: s.kind === "result" || s.kind === "subtotal" ? 700 : 400, background: s.kind === "result" ? `${AMPEL_COLOR[s.cents < 0 ? "rot" : "gruen"]}14` : undefined }}>
                  <td style={{ width: "38%" }}>{s.label}</td>
                  <td style={{ width: "30%" }}><div style={{ height: 9, background: "var(--panel-2)", borderRadius: 5, overflow: "hidden" }}><div style={{ width: `${w}%`, height: "100%", background: s.cents < 0 ? AMPEL_COLOR.rot : "#16a57155" }} /></div></td>
                  <td style={{ textAlign: "right", width: "18%", color: s.cents < 0 ? AMPEL_COLOR.rot : "var(--text)" }}>{signed(s.cents)}</td>
                  <td style={{ textAlign: "right", width: "14%" }} className="muted">{pctFmt(s.pctOfNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>% jeweils vom Nettoumsatz.</p>
      </section>

      {/* Wochen-Historie */}
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
                  <td><span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%", background: AMPEL_COLOR[w.pnl.ampel] }} /></td>
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
