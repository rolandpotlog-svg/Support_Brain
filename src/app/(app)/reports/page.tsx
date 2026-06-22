import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { fullReport, unclassifiedInPeriod, weekdayLabel } from "@/server/reports";
import { ShopSwitcher } from "../inbox/shop-switcher";
import { ComplaintAnalysis } from "./complaint-analysis";
import { ClassifyButton } from "./classify-button";
import { TestReportButton } from "./test-report-button";

const STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  pending: "Wartet",
  escalated: "Eskaliert",
  closed: "Erledigt",
  spam: "Spam",
};

function Trend({ cur, prev }: { cur: number; prev: number }) {
  const d = cur - prev;
  if (prev === 0 && cur === 0) return null;
  const up = d > 0;
  const flat = d === 0;
  const color = flat ? "var(--text-2)" : up ? "#e5634d" : "#3fb950";
  const sign = up ? "▲ +" : flat ? "– " : "▼ ";
  return (
    <span style={{ color, fontSize: 12, marginLeft: 6 }}>
      {sign}
      {Math.abs(d)} vs. Vorperiode
    </span>
  );
}

function fmtMin(m: number | null): string {
  if (m === null) return "—";
  return m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`;
}
function fmtHours(h: number | null): string {
  if (h === null) return "—";
  return h >= 48 ? `${(h / 24).toFixed(1)} Tage` : `${h} h`;
}

function Bars({ data, label }: { data: { k: string; n: number }[]; label?: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar" key={d.k}>
          <div className="bar-fill" style={{ height: `${Math.round((d.n / max) * 80) + 4}px` }} title={`${d.n}`} />
          <div className="bar-label">{d.k}</div>
          <div className="bar-n muted">{d.n}</div>
        </div>
      ))}
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  const { days: daysParam } = await searchParams;
  const days = daysParam === "30" ? 30 : 7;

  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));

  if (!activeShopId) {
    return (
      <div className="adminwrap">
        <h1 style={{ marginTop: 0 }}>Auswertung</h1>
        <p className="muted">Kein aktiver Shop.</p>
      </div>
    );
  }
  if (!(await brandAccess(user, activeShopId)).reports) redirect("/inbox");

  const [r, pending] = await Promise.all([
    fullReport(activeShopId, days),
    unclassifiedInPeriod(activeShopId, days),
  ]);
  const draftTotal = r.draftOutcomes.verbatim + r.draftOutcomes.edited + r.draftOutcomes.manual;
  const pct = (n: number) => (draftTotal ? Math.round((n / draftTotal) * 100) : 0);
  const maxCat = Math.max(1, ...r.byCategory.map((c) => c.n));

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Auswertung</h1>
        <div className="srcrow">
          <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/reports" />
          <Link href="/reports?days=7" className={`btnlink ${days === 7 ? "primary" : ""}`}>7 Tage</Link>
          <Link href="/reports?days=30" className={`btnlink ${days === 30 ? "primary" : ""}`}>30 Tage</Link>
        </div>
      </div>

      {/* Wochenbericht (automatisch montags) */}
      <section className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          Automatischer Wochenbericht: montags 07:00 (Empfänger im Admin pro Shop). Hier zum Testen sofort senden.
        </span>
        <TestReportButton shopId={activeShopId} days={days} />
      </section>

      {/* Frühwarnungen */}
      {r.warnings.length > 0 && (
        <section className="card" style={{ borderColor: "#e5634d55", background: "#e5634d11" }}>
          <h2 style={{ marginTop: 0 }}>⚠️ Frühwarnungen</h2>
          <ul className="esc-list">
            {r.warnings.map((w, i) => (
              <li key={i}><strong>{w.title}</strong> — <span className="muted">{w.detail}</span></li>
            ))}
          </ul>
        </section>
      )}

      {/* 1 Volumen & Last */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Volumen &amp; Last</h2>
        <div className="report">
          <div className="rstat"><div className="k">Mails rein</div><div className="v">{r.inbound}</div><Trend cur={r.inbound} prev={r.inboundPrev} /></div>
          <div className="rstat"><div className="k">Antworten</div><div className="v">{r.replies}</div></div>
          <div className="rstat"><div className="k">Neue Tickets</div><div className="v">{r.newTickets}</div><Trend cur={r.newTickets} prev={r.newTicketsPrev} /></div>
          <div className="rstat"><div className="k">davon wieder-offen</div><div className="v">{r.reopened}</div></div>
          <div className="rstat"><div className="k">Kunden</div><div className="v">{r.uniqueCustomers}</div></div>
          <div className="rstat"><div className="k">Ø Nachr./Kunde</div><div className="v">{r.avgMsgsPerCustomer}</div></div>
          <div className="rstat"><div className="k">Ø Nachr./Ticket</div><div className="v">{r.avgMsgsPerTicket}</div></div>
          <div className="rstat"><div className="k">Eskalationen</div><div className="v">{r.escalations}</div><Trend cur={r.escalations} prev={r.escalationsPrev} /></div>
        </div>
      </section>

      {/* 2 Themen */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Themen — das „Warum"</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {r.classifiedCount} von {r.newTickets} neuen Tickets klassifiziert
          {r.unclassifiedCount > 0 ? ` · ${r.unclassifiedCount} offen` : ""}.
        </p>
        <ClassifyButton shopId={activeShopId} days={days} pending={pending} />
        {r.byCategory.length > 0 ? (
          <table className="cat-table" style={{ marginTop: 14 }}>
            <tbody>
              {r.byCategory.map((c) => (
                <tr key={c.category}>
                  <td style={{ width: 220 }}>{c.category}</td>
                  <td style={{ width: 160 }}>
                    <div className="catbar" style={{ width: `${Math.round((c.n / maxCat) * 100)}%` }} />
                  </td>
                  <td><strong>{c.n}</strong> <Trend cur={c.n} prev={c.prev} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Noch keine Klassifizierung — Button oben klicken.</p>
        )}

        {r.byProduct.length > 0 && (
          <>
            <h3>Produkte mit den meisten Beschwerden</h3>
            <ul className="esc-list">
              {r.byProduct.slice(0, 6).map((p) => (
                <li key={p.product}>{p.product}: <strong>{p.n}</strong></li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 3 Effizienz */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Effizienz</h2>
        <div className="report">
          <div className="rstat"><div className="k">Ø erste Antwort</div><div className="v">{fmtMin(r.avgFirstResponseMin)}</div></div>
          <div className="rstat"><div className="k">Ø Lösungszeit</div><div className="v">{fmtHours(r.avgResolutionHours)}</div></div>
          <div className="rstat"><div className="k">Im 1. Anlauf gelöst</div><div className="v">{r.fcrRate === null ? "—" : `${Math.round(r.fcrRate * 100)} %`}</div></div>
          <div className="rstat"><div className="k">Rückstau (&gt;48 h)</div><div className="v">{r.backlogAging}</div></div>
        </div>
      </section>

      {/* 4 KI-Qualität + Sentiment */}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card" style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ marginTop: 0 }}>KI-Entwurf-Qualität</h2>
          {draftTotal === 0 ? (
            <p className="muted">Noch keine Antworten im Zeitraum.</p>
          ) : (
            <ul className="esc-list">
              <li>1:1 übernommen: <strong>{r.draftOutcomes.verbatim}</strong> ({pct(r.draftOutcomes.verbatim)} %)</li>
              <li>bearbeitet: <strong>{r.draftOutcomes.edited}</strong> ({pct(r.draftOutcomes.edited)} %)</li>
              <li>ohne KI-Entwurf: <strong>{r.draftOutcomes.manual}</strong> ({pct(r.draftOutcomes.manual)} %)</li>
            </ul>
          )}
        </section>
        <section className="card" style={{ flex: 1, minWidth: 260 }}>
          <h2 style={{ marginTop: 0 }}>Stimmung</h2>
          <ul className="esc-list">
            <li>😊 positiv: <strong>{r.sentiment.positiv}</strong></li>
            <li>😐 neutral: <strong>{r.sentiment.neutral}</strong></li>
            <li>😠 negativ: <strong>{r.sentiment.negativ}</strong></li>
          </ul>
        </section>
      </div>

      {/* Retouren-Portal */}
      {r.returns.total > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Retouren-Portal</h2>
          <div className="report">
            <div className="rstat"><div className="k">Anfragen</div><div className="v">{r.returns.total}</div></div>
            <div className="rstat"><div className="k">Behalten (deflektiert)</div><div className="v">{r.returns.deflected}</div></div>
            <div className="rstat"><div className="k">Zurückgewonnen</div><div className="v">{(r.returns.recoveredCents / 100).toFixed(2)} €</div></div>
            <div className="rstat"><div className="k">Wareneingang</div><div className="v">{r.returns.received}</div></div>
            <div className="rstat"><div className="k">Restock</div><div className="v">{r.returns.restocked}</div></div>
            <div className="rstat"><div className="k">Beschädigt</div><div className="v">{r.returns.damaged}</div></div>
            <div className="rstat"><div className="k">Defekt-Reklamationen</div><div className="v">{r.returns.defectClaims}</div></div>
          </div>
        </section>
      )}

      {/* Status + Tags */}
      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ marginTop: 0 }}>Neue Tickets nach Status</h2>
          {r.byStatus.length === 0 && <p className="muted">Keine.</p>}
          <ul className="esc-list">
            {r.byStatus.map((x) => (
              <li key={x.status}>{STATUS_LABEL[x.status] ?? x.status}: <strong>{x.n}</strong></li>
            ))}
          </ul>
        </section>
        <section className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2 style={{ marginTop: 0 }}>Top-Tags</h2>
          {r.byTag.length === 0 && <p className="muted">Keine Tags vergeben.</p>}
          <ul className="esc-list">
            {r.byTag.slice(0, 8).map((x) => (
              <li key={x.tag}>{x.tag}: <strong>{x.n}</strong></li>
            ))}
          </ul>
        </section>
      </div>

      {/* Last nach Zeit */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Eingang nach Wochentag</h2>
        {r.byWeekday.length === 0 ? (
          <p className="muted">Keine eingehenden Mails im Zeitraum.</p>
        ) : (
          <Bars data={r.byWeekday.map((w) => ({ k: weekdayLabel(w.dow), n: w.n }))} />
        )}
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Eingang nach Uhrzeit</h2>
        {r.byHour.length === 0 ? (
          <p className="muted">Keine eingehenden Mails im Zeitraum.</p>
        ) : (
          <Bars data={r.byHour.map((h) => ({ k: `${h.hour}`, n: h.n }))} />
        )}
      </section>

      {/* Freitext-Analyse (Bonus) */}
      <section className="card">
        <h2 style={{ marginTop: 0 }}>KI-Zusammenfassung (Freitext)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Claude fasst die Anfragen der letzten {days} Tage in Worten zusammen (Kategorien, Trends, Empfehlungen).
        </p>
        <ComplaintAnalysis shopId={activeShopId} days={days} />
      </section>
    </div>
  );
}
