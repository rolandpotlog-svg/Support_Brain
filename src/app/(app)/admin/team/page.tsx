// Team-Aktivität (nur Owner): wer war wann eingeloggt, wie lange aktiv, wie viel beantwortet.
// Aktiv = Tab sichtbar + Maus/Tastatur in den letzten 2 Min. (Minuten-Herzschlag, siehe activity-ping.tsx).
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { requireUser } from "@/server/access";

const TZ = "Europe/Vienna";
const GAP_MIN = 10; // Pause > 10 Min. = neuer Arbeitsblock

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => {
  const r = await db.execute(q);
  return ((r as unknown as { rows?: Row[] }).rows ?? (r as unknown as Row[])) as Row[];
};
const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h`;
const clock = (d: unknown) => (d ? new Date(String(d)).toLocaleTimeString("de-AT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) : "—");

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const me = await requireUser();
  if (!me.isOwner) redirect("/admin");
  const sp = await searchParams;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.tag ?? "") ? sp.tag! : today;
  const shift = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };

  const users = await rows(sql`select id, coalesce(name, email) as name, email, role, active from users where active order by role desc, created_at`);

  // Aktive Minuten des Tages je Nutzer (Minute seit Mitternacht, Wiener Zeit)
  const mins = await rows(sql`
    select m.user_id, extract(hour from m.minute at time zone ${TZ})::int * 60 + extract(minute from m.minute at time zone ${TZ})::int as mod,
           s.name as shop
    from user_active_minute m left join shops s on s.id = m.shop_id
    where (m.minute at time zone ${TZ})::date = ${day}::date
    order by 1, 2`);
  const logins = await rows(sql`
    select user_id, at, device from user_login
    where (at at time zone ${TZ})::date = ${day}::date order by at`);
  const sent = await rows(sql`
    select m.sent_by as user_id, s.name as shop, count(*)::int as n,
           count(*) filter (where m.ai_outcome = 'verbatim')::int as verbatim,
           count(*) filter (where m.ai_outcome = 'edited')::int as edited,
           count(distinct m.thread_id)::int as tickets
    from messages m join threads t on t.id = m.thread_id join shops s on s.id = t.shop_id
    where m.direction = 'outbound' and not m.internal and m.sent_by is not null
      and (m.created_at at time zone ${TZ})::date = ${day}::date
    group by 1, 2`);
  const week = await rows(sql`
    with d as (select generate_series(${day}::date - 6, ${day}::date, interval '1 day')::date as day)
    select u.id as user_id, to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from user_active_minute m where m.user_id = u.id and (m.minute at time zone ${TZ})::date = d.day) as active,
      (select count(*)::int from messages m where m.sent_by = u.id and m.direction = 'outbound' and not m.internal and (m.created_at at time zone ${TZ})::date = d.day) as replies
    from users u cross join d where u.active order by d.day`);
  const online = new Set(
    (await rows(sql`select distinct user_id from user_active_minute where minute > now() - interval '3 minutes'`)).map((r) => String(r.user_id)),
  );

  const days7 = Array.from({ length: 7 }, (_, i) => shift(day, i - 6));

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/admin" className="back">← Admin</Link>
          <h1 style={{ margin: 0 }}>Team</h1>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Link className="fchip" href={`/admin/team?tag=${shift(day, -1)}`}>←</Link>
          <span className="fchip active">{new Date(`${day}T12:00:00Z`).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
          {day < today && <Link className="fchip" href={`/admin/team?tag=${shift(day, 1)}`}>→</Link>}
          {day !== today && <Link className="fchip" href="/admin/team">Heute</Link>}
        </div>
      </div>

      {users.map((u) => {
        const id = String(u.id);
        const m = mins.filter((r) => String(r.user_id) === id).map((r) => ({ mod: Number(r.mod), shop: r.shop ? String(r.shop) : null }));
        const lg = logins.filter((r) => String(r.user_id) === id);
        const st = sent.filter((r) => String(r.user_id) === id);
        // Arbeitsblöcke
        const blocks: { from: number; to: number }[] = [];
        for (const x of m) {
          const b = blocks[blocks.length - 1];
          if (b && x.mod - b.to <= GAP_MIN) b.to = x.mod;
          else blocks.push({ from: x.mod, to: x.mod });
        }
        const replies = st.reduce((a, r) => a + Number(r.n), 0);
        const verbatim = st.reduce((a, r) => a + Number(r.verbatim), 0);
        const edited = st.reduce((a, r) => a + Number(r.edited), 0);
        const tickets = st.reduce((a, r) => a + Number(r.tickets), 0);
        const firstLogin = lg[0]?.at;
        const perShop = new Map<string, number>();
        for (const x of m) if (x.shop) perShop.set(x.shop, (perShop.get(x.shop) ?? 0) + 1);
        const w = week.filter((r) => String(r.user_id) === id);
        const fmtMod = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

        return (
          <section className="card" key={id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>
                {online.has(id) && <span className="due-dot" style={{ background: "var(--green)", marginRight: 8 }} title="gerade aktiv" />}
                {String(u.name)}
                {u.role === "owner" && <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}> · Inhaber</span>}
              </h2>
              <span className="muted" style={{ fontSize: 13 }}>{online.has(id) ? "gerade aktiv" : m.length ? `zuletzt aktiv ${fmtMod(m[m.length - 1].mod)}` : "heute nicht aktiv"}</span>
            </div>

            <div className="report" style={{ marginTop: 10 }}>
              <div className="rstat"><div className="k">Erster Login</div><div className="v">{clock(firstLogin)}</div></div>
              <div className="rstat"><div className="k">Aktiv</div><div className="v">{hm(m.length)}</div></div>
              <div className="rstat"><div className="k">Antworten</div><div className="v">{replies}</div></div>
              <div className="rstat"><div className="k">Tickets</div><div className="v">{tickets}</div></div>
              <div className="rstat">
                <div className="k">KI unverändert</div>
                <div className="v">{verbatim + edited ? `${Math.round((verbatim / (verbatim + edited)) * 100)} %` : "—"}</div>
              </div>
            </div>

            {/* Tagesverlauf 0–24 Uhr */}
            <div className="tl" aria-label="Tagesverlauf">
              {blocks.map((b, i) => {
                const start = b.from, end = Math.min(b.to + 1, 1440);
                if (end <= start) return null;
                return <span key={i} className="tl-b" style={{ left: `${(start / 1440) * 100}%`, width: `${Math.max(((end - start) / 1440) * 100, 0.3)}%` }} title={`${fmtMod(b.from)}–${fmtMod(b.to + 1)}`} />;
              })}
              {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <span key={h} className="tl-h" style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}
            </div>

            <div style={{ fontSize: 13, display: "grid", gap: 4, marginTop: 22 }}>
              {blocks.length > 0 && <div><span className="muted">Arbeitsblöcke:</span> {blocks.map((b) => `${fmtMod(b.from)}–${fmtMod(b.to + 1)}`).join(" · ")}</div>}
              {perShop.size > 0 && <div><span className="muted">Zeit je Shop:</span> {[...perShop].map(([s, n]) => `${s} ${hm(n)}`).join(" · ")}</div>}
              {st.length > 0 && <div><span className="muted">Antworten je Shop:</span> {st.map((r) => `${r.shop} ${r.n}`).join(" · ")}</div>}
              {lg.length > 0 && <div><span className="muted">Logins:</span> {lg.map((r) => `${clock(r.at)}${r.device ? ` (${r.device})` : ""}`).join(" · ")}</div>}
            </div>

            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th />
                    {days7.map((d) => <th key={d}>{new Date(`${d}T12:00:00Z`).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit" })}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="muted">Aktiv</td>
                    {days7.map((d) => { const r = w.find((x) => x.day === d); return <td key={d}>{r && Number(r.active) ? hm(Number(r.active)) : "—"}</td>; })}
                  </tr>
                  <tr>
                    <td className="muted">Antworten</td>
                    {days7.map((d) => { const r = w.find((x) => x.day === d); return <td key={d}>{r && Number(r.replies) ? Number(r.replies) : "—"}</td>; })}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="muted" style={{ fontSize: 12 }}>
        Aktiv zählt nur, wenn das Tool sichtbar ist und in den letzten 2 Minuten Maus oder Tastatur benutzt wurde. Logins ab heute; aktive Zeit ab dem ersten Login nach dem Update.
      </p>
    </div>
  );
}
