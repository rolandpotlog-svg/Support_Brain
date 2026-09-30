// KI-Gehirn: was die KI gelernt hat (Lernbuch) + wie gut sie ist. Je Shop getrennt.
import { redirect } from "next/navigation";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { intentLabel } from "@/lib/support/intents";
import { timeAgo } from "@/lib/format";
import { AddLesson, LessonRow } from "./lesson-actions";

const SOURCE: Record<string, string> = { edit: "aus Korrektur", shadow: "aus Schattenbetrieb", manual: "manuell" };

export default async function GehirnPage() {
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
    : [];
  const shopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!shopId || !(await brandAccess(user, shopId)).settings) redirect("/inbox");

  const lessons = await db.select().from(schema.shopLesson).where(eq(schema.shopLesson.shopId, shopId)).orderBy(desc(schema.shopLesson.hits), desc(schema.shopLesson.createdAt));
  const proposals = lessons.filter((l) => l.status === "vorschlag");
  const active = lessons.filter((l) => l.status === "aktiv");

  // Qualität der letzten 30 Tage: Anteil unverändert gesendeter KI-Entwürfe (+ Schattenbetrieb: hätte gepasst).
  const since = new Date(Date.now() - 30 * 86_400_000);
  const q = await db
    .select({ outcome: schema.messages.aiOutcome, match: schema.messages.aiShadowMatch, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.direction, "outbound"), isNotNull(schema.messages.aiDraft), gte(schema.messages.createdAt, since)))
    .groupBy(schema.messages.aiOutcome, schema.messages.aiShadowMatch);
  const verbatim = q.filter((r) => r.outcome === "verbatim").reduce((s, r) => s + r.n, 0);
  const edited = q.filter((r) => r.outcome === "edited").reduce((s, r) => s + r.n, 0);
  const shadowOk = q.filter((r) => r.outcome === "shadow" && r.match).reduce((s, r) => s + r.n, 0);
  const shadowAll = q.filter((r) => r.outcome === "shadow" && r.match != null).reduce((s, r) => s + r.n, 0);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

  // KI-Kosten + Tempo (letzte 30 Tage, dieser Shop). Kosten in USD protokolliert, hier ca. in € (Kurs 0,90).
  const usage = await db
    .select({
      kind: schema.aiUsage.kind,
      n: sql<number>`count(*)::int`,
      micro: sql<number>`coalesce(sum(${schema.aiUsage.costMicroUsd}),0)::bigint`,
      ms: sql<number>`coalesce(avg(${schema.aiUsage.durationMs}),0)::int`,
      cacheRead: sql<number>`coalesce(sum(${schema.aiUsage.cacheReadTokens}),0)::bigint`,
      input: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}),0)::bigint`,
    })
    .from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.shopId, shopId), gte(schema.aiUsage.createdAt, since)))
    .groupBy(schema.aiUsage.kind);
  const EUR = 0.9;
  const totalEur = (usage.reduce((s, u) => s + Number(u.micro), 0) / 1_000_000) * EUR;
  const drafts = usage.find((u) => u.kind === "entwurf");
  const mails = usage.find((u) => u.kind === "einordnung")?.n ?? drafts?.n ?? 0;
  const perMailCt = mails ? (totalEur / mails) * 100 : null;
  const cacheShare = (() => {
    const cr = usage.reduce((s, u) => s + Number(u.cacheRead), 0);
    const inp = usage.reduce((s, u) => s + Number(u.input), 0);
    return cr + inp ? Math.round((cr / (cr + inp)) * 100) : null;
  })();

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>KI-Gehirn</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Was die KI aus euren Korrekturen gelernt hat. Vorschläge entstehen automatisch, sobald ihr einen Entwurf ändert. Erst nach „Übernehmen“ gelten sie für jede neue Antwort in diesem Shop.
      </p>

      <div className="report">
        <div className="rstat"><div className="k">Unverändert gesendet (30 T.)</div><div className="v">{pct(verbatim, verbatim + edited) ?? "—"}{verbatim + edited ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{verbatim} von {verbatim + edited} Entwürfen</div></div>
        <div className="rstat"><div className="k">Schattenbetrieb: hätte gepasst</div><div className="v">{pct(shadowOk, shadowAll) ?? "—"}{shadowAll ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{shadowOk} von {shadowAll}</div></div>
        <div className="rstat"><div className="k">KI-Kosten (30 T.)</div><div className="v">{totalEur.toFixed(2).replace(".", ",")} €</div><div className="muted" style={{ fontSize: 12 }}>{perMailCt != null ? `ca. ${perMailCt.toFixed(1).replace(".", ",")} ct pro Mail` : "noch keine Daten"}{cacheShare != null ? ` · ${cacheShare} % aus Cache` : ""}</div></div>
        <div className="rstat"><div className="k">Ø Dauer Entwurf</div><div className="v">{drafts ? `${(drafts.ms / 1000).toFixed(0)} s` : "—"}</div><div className="muted" style={{ fontSize: 12 }}>läuft im Hintergrund vor dem Öffnen</div></div>
        <div className="rstat"><div className="k">Aktive Regeln</div><div className="v">{active.length}</div></div>
        <div className="rstat"><div className="k">Offene Vorschläge</div><div className="v">{proposals.length}</div></div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Vorschläge ({proposals.length})</h2>
        {proposals.length === 0 ? (
          <p className="muted">Keine offenen Vorschläge. Neue entstehen, wenn ein KI-Entwurf vor dem Senden geändert wird.</p>
        ) : (
          proposals.map((l) => (
            <div key={l.id} className="lesson">
              <div className="lesson-meta">
                {SOURCE[l.source] ?? l.source} · {l.intent ? intentLabel(l.intent) : "alle Anliegen"} · {timeAgo(new Date(l.createdAt))}
                {l.hits > 1 ? <b> · {l.hits}× so korrigiert</b> : null}
              </div>
              <LessonRow id={l.id} rule={l.rule} status={l.status} />
              {l.evidence && <details className="lesson-ev"><summary>Beispiel ansehen</summary><pre>{l.evidence}</pre></details>}
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Aktive Regeln ({active.length})</h2>
        <AddLesson shopId={shopId} />
        {active.map((l) => (
          <div key={l.id} className="lesson">
            <div className="lesson-meta">{SOURCE[l.source] ?? l.source} · {l.intent ? intentLabel(l.intent) : "alle Anliegen"}{l.hits > 1 ? ` · ${l.hits}×` : ""}</div>
            <LessonRow id={l.id} rule={l.rule} status={l.status} />
          </div>
        ))}
      </section>
    </div>
  );
}
