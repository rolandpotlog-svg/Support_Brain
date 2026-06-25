// Finance-Cockpit (Landing): Ampel + GAP-Urteil + Headline-Kennzahlen + GuV-Wasserfall.
// Liest die bestehende Wochen-PnL-Engine (keine eigene Rechenlogik). finance-Cap.
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { cockpitMetrics, waterfallSteps } from "@/lib/finance/cockpit";
import { currentWeekStart, weekOf } from "@/lib/finance/week";

const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
const eur2 = (c: number) => `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const signed = (c: number) => `${c >= 0 ? "+" : "−"}${eur(Math.abs(c))}`;
const roasFmt = (r: number | null) => (r == null ? "—" : r.toFixed(2));
const pctFmt = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)} %`);
const AMPEL_COLOR: Record<string, string> = { rot: "#e5634d", gelb: "#d9a300", gruen: "#3fb950", neutral: "#9aa0ab" };
const AMPEL_WORD: Record<string, string> = { rot: "ROT — fixen", gelb: "GELB — beobachten", gruen: "GRÜN — skalieren", neutral: "NEUTRAL — Spend fehlt" };

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

export default async function CockpitPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: weekParam } = await searchParams;
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

  const targetStart = weekParam ? weekOf(new Date(`${weekParam}T12:00:00Z`)).weekStart : lastComplete?.weekStart;
  const idx = report.weeks.findIndex((w) => w.weekStart === targetStart);
  const sel: WeekRow | undefined = idx >= 0 ? report.weeks[idx] : lastComplete;
  const prior: WeekRow | undefined = sel ? report.weeks[report.weeks.findIndex((w) => w.weekStart === sel.weekStart) + 1] : undefined;

  if (!sel) {
    return (
      <div className="adminwrap">
        <div className="formhead" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>Finance · Cockpit</h1>
          <Link href="/finance" className="btnlink">⚙ Daten &amp; Setup</Link>
        </div>
        <section className="card"><p className="muted" style={{ margin: 0 }}>Noch keine Wochendaten.</p></section>
      </div>
    );
  }

  const m = cockpitMetrics(sel.inputs, sel.pnl, sel.orderCount);
  const pm = prior ? cockpitMetrics(prior.inputs, prior.pnl, prior.orderCount) : null;
  const color = AMPEL_COLOR[m.ampel];
  const isLive = sel.weekStart >= cw;
  const steps = waterfallSteps(sel.inputs, sel.pnl);
  const maxAbs = Math.max(...steps.map((s) => Math.abs(s.cents)), 1);

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Finance · Cockpit</h1>
        <div className="srcrow" style={{ margin: 0, gap: 8, alignItems: "center" }}>
          {lastComplete && <Link href={`/finance/cockpit?week=${lastComplete.weekStart}`} className="btnlink">Letzte KW</Link>}
          <Link href={`/finance/cockpit?week=${cw}`} className="btnlink">Diese KW</Link>
          <form method="get" style={{ margin: 0 }}>
            <select name="week" defaultValue={sel.weekStart} className="shopswitch" style={{ padding: "5px 8px" }} aria-label="Woche">
              {report.weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>{w.label}</option>)}
            </select>
          </form>
          <Link href="/finance" className="btnlink">⚙ Daten &amp; Setup</Link>
        </div>
      </div>

      {/* Headline: Ampel + GAP + Urteil */}
      <section className="card" style={{ borderColor: `${color}66`, background: `${color}0f` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: color, flex: "0 0 auto", boxShadow: `0 0 0 5px ${color}33` }} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {sel.label} {isLive && <span style={{ fontSize: 13, color: "var(--muted)" }}>· läuft (vorläufig)</span>}: {AMPEL_WORD[m.ampel]}
            </div>
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

      {/* Ebene 1: Headline-Kennzahlen mit Delta */}
      <section className="card">
        <div className="report">
          <Tile k="Nettoumsatz" v={eur(m.nettoCents)} sub={pm ? `${signed(m.nettoCents - pm.nettoCents)} vs. Vorwoche` : undefined} />
          <Tile k="DB nach Werbung" v={eur(m.dbNachWerbungCents)} color={m.dbNachWerbungCents < 0 ? AMPEL_COLOR.rot : undefined} sub={pm ? `${signed(m.dbNachWerbungCents - pm.dbNachWerbungCents)}` : undefined} />
          <Tile k="Profit (nach Fix)" v={eur(m.profitCents)} color={m.profitCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen} sub={`Marge ${pctFmt(m.margePct)}`} />
        </div>
      </section>

      {/* Ebene 2: Hebel */}
      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Hebel</h2>
        <div className="report">
          <Tile k="Marketing (Spend)" v={eur(m.spendCents)} sub={CHANNEL_SUB(sel)} />
          <Tile k="Rabattquote" v={pctFmt(m.rabattquote)} color={(m.rabattquote ?? 0) > 0.25 ? AMPEL_COLOR.rot : undefined} />
          <Tile k="Retourenquote" v={pctFmt(m.retourenquote)} />
          <Tile k="AOV (brutto)" v={m.aovCents == null ? "—" : eur2(m.aovCents)} />
          <Tile k="COGS %" v={pctFmt(m.cogsPct)} />
          <Tile k="Versand %" v={pctFmt(m.versandPct)} />
          <Tile k="DB-Marge" v={pctFmt(m.dbMargePct)} />
        </div>
      </section>

      {/* GuV-Wasserfall */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>GuV-Wasserfall · {sel.label}</h2>
        <table className="fin-table">
          <tbody>
            {steps.map((s) => {
              const result = s.kind === "result";
              const subtotal = s.kind === "subtotal";
              const barColor = s.cents < 0 ? AMPEL_COLOR.rot : "#3fb95066";
              const w = Math.round((Math.abs(s.cents) / maxAbs) * 100);
              return (
                <tr key={s.label} style={{ fontWeight: result || subtotal ? 700 : 400, background: result ? `${AMPEL_COLOR[s.cents < 0 ? "rot" : "gruen"]}14` : undefined }}>
                  <td style={{ width: "38%" }}>{s.label}</td>
                  <td style={{ width: "30%" }}>
                    <div style={{ height: 10, background: "var(--panel-2)", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ width: `${w}%`, height: "100%", background: barColor }} />
                    </div>
                  </td>
                  <td style={{ textAlign: "right", width: "18%", color: s.cents < 0 ? AMPEL_COLOR.rot : "var(--text)" }}>{signed(s.cents)}</td>
                  <td style={{ textAlign: "right", width: "14%" }} className="muted">{pctFmt(s.pctOfNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>% jeweils vom Nettoumsatz. Klick eine Woche in der Historie unten, um sie hier zu sehen.</p>
      </section>

      {/* Wochen-Historie (klickbar) */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Wochen-Historie</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="fin-table">
            <thead><tr><th>KW</th><th>Netto</th><th>Spend</th><th>ROAS</th><th>BE-ROAS</th><th>PnL</th><th>Ampel</th></tr></thead>
            <tbody>
              {report.weeks.map((w) => {
                const active = w.weekStart === sel.weekStart;
                return (
                  <tr key={w.weekStart} style={active ? { background: "var(--panel-2)", fontWeight: 700 } : undefined}>
                    <td><Link href={`/finance/cockpit?week=${w.weekStart}`} className="btnlink" style={{ fontWeight: 700 }}>{w.label}</Link></td>
                    <td>{eur(w.pnl.nettoumsatzCents)}</td>
                    <td>{eur(w.inputs.marketingCents)}</td>
                    <td>{roasFmt(w.pnl.roasGesamt)}</td>
                    <td>{roasFmt(w.pnl.beRoasGesamt)}</td>
                    <td style={{ color: w.pnl.pnlCents < 0 ? AMPEL_COLOR.rot : AMPEL_COLOR.gruen }}>{eur(w.pnl.pnlCents)}</td>
                    <td><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: AMPEL_COLOR[w.pnl.ampel] }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CHANNEL_SUB(w: WeekRow): string {
  const parts = Object.entries(w.marketingByChannel)
    .filter(([, c]) => c > 0)
    .map(([ch, c]) => `${ch}: ${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })}€`);
  return parts.join(" · ");
}
