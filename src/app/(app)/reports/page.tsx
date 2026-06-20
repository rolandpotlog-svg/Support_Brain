import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { weekdayLabel, weeklyStats } from "@/server/reports";
import { ShopSwitcher } from "../inbox/shop-switcher";
import { ComplaintAnalysis } from "./complaint-analysis";

const STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  pending: "Wartet",
  escalated: "Eskaliert",
  closed: "Erledigt",
  spam: "Spam",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");
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

  const s = await weeklyStats(activeShopId, days);
  const maxDow = Math.max(1, ...s.byWeekday.map((w) => w.n));

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Auswertung</h1>
        <div className="srcrow">
          {activeShopId && <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/reports" />}
          <Link href="/reports?days=7" className={`btnlink ${days === 7 ? "primary" : ""}`}>7 Tage</Link>
          <Link href="/reports?days=30" className={`btnlink ${days === 30 ? "primary" : ""}`}>30 Tage</Link>
        </div>
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Mails rein</div><div className="v">{s.inbound}</div></div>
          <div className="rstat"><div className="k">Antworten</div><div className="v">{s.replies}</div></div>
          <div className="rstat"><div className="k">Neue Tickets</div><div className="v">{s.newTickets}</div></div>
          <div className="rstat"><div className="k">Kunden</div><div className="v">{s.uniqueCustomers}</div></div>
          <div className="rstat"><div className="k">Ø Nachrichten/Kunde</div><div className="v">{s.avgMsgsPerCustomer}</div></div>
          <div className="rstat"><div className="k">Ø Nachrichten/Ticket</div><div className="v">{s.avgMsgsPerTicket}</div></div>
          <div className="rstat"><div className="k">Eskalationen</div><div className="v">{s.escalations}</div></div>
        </div>
      </section>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <section className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2>Neue Tickets nach Status</h2>
          {s.byStatus.length === 0 && <p className="muted">Keine.</p>}
          <ul className="esc-list">
            {s.byStatus.map((x) => (
              <li key={x.status}>{STATUS_LABEL[x.status] ?? x.status}: <strong>{x.n}</strong></li>
            ))}
          </ul>
        </section>

        <section className="card" style={{ flex: 1, minWidth: 240 }}>
          <h2>Top-Tags</h2>
          {s.byTag.length === 0 && <p className="muted">Keine Tags vergeben.</p>}
          <ul className="esc-list">
            {s.byTag.slice(0, 8).map((x) => (
              <li key={x.tag}>{x.tag}: <strong>{x.n}</strong></li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card">
        <h2>Eingang nach Wochentag</h2>
        {s.byWeekday.length === 0 && <p className="muted">Keine eingehenden Mails im Zeitraum.</p>}
        <div className="bars">
          {s.byWeekday.map((w) => (
            <div className="bar" key={w.dow}>
              <div className="bar-fill" style={{ height: `${Math.round((w.n / maxDow) * 80) + 4}px` }} title={`${w.n}`} />
              <div className="bar-label">{weekdayLabel(w.dow)}</div>
              <div className="bar-n muted">{w.n}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>KI-Analyse der häufigsten Beschwerden</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Claude liest die eingegangenen Anfragen der letzten {days} Tage und fasst Kategorien,
          Auffälligkeiten und Empfehlungen zusammen.
        </p>
        <ComplaintAnalysis shopId={activeShopId} days={days} />
      </section>
    </div>
  );
}
