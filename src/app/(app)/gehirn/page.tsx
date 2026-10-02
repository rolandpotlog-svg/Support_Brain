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

  // Die eigentliche Frage: Wie oft ändert der Mensch Entwürfe, die die KI ALLEIN beantworten wollte (AUTO) —
  // und wie oft solche, die sie ohnehin an ihn abgegeben hat (MENSCH = Entscheidung nötig)?
  const dq = await db
    .select({ decision: schema.messages.aiDecision, outcome: schema.messages.aiOutcome, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.direction, "outbound"), isNotNull(schema.messages.aiDraft), inArray(schema.messages.aiOutcome, ["verbatim", "edited"]), gte(schema.messages.createdAt, since)))
    .groupBy(schema.messages.aiDecision, schema.messages.aiOutcome);
  const dcnt = (d: string, o: string) => dq.filter((r) => (r.decision ?? "unbekannt") === d && r.outcome === o).reduce((a, r) => a + r.n, 0);
  const autoVerb = dcnt("auto", "verbatim"), autoEdit = dcnt("auto", "edited"), humVerb = dcnt("mensch", "verbatim"), humEdit = dcnt("mensch", "edited");

  // Prüfer-Zuverlässigkeit: Stimmt „Prüfung bestanden“ mit dem überein, was der Mensch tut (unverändert senden)?
  const pq = await db
    .select({ passed: schema.messages.aiCheckPassed, outcome: schema.messages.aiOutcome, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.direction, "outbound"), isNotNull(schema.messages.aiCheckPassed), gte(schema.messages.createdAt, since)))
    .groupBy(schema.messages.aiCheckPassed, schema.messages.aiOutcome);
  const cnt = (p: boolean, o: string) => pq.filter((r) => r.passed === p && r.outcome === o).reduce((a, r) => a + r.n, 0);
  // Trockenlauf: Entwürfe, die automatisch rausgegangen wären — hat der Mensch sie unverändert gesendet?
  const dry = await db
    .select({ intent: schema.threads.aiIntent, outcome: schema.messages.aiOutcome, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.direction, "outbound"), eq(schema.messages.aiAutoEligible, true), inArray(schema.messages.aiOutcome, ["verbatim", "edited"]), gte(schema.messages.createdAt, since)))
    .groupBy(schema.threads.aiIntent, schema.messages.aiOutcome);
  const dryOf = (k: string | null, o: string) => dry.filter((r) => (k === null || (r.intent ?? "sonstiges") === k) && r.outcome === o).reduce((a, r) => a + r.n, 0);
  const dryVerb = dryOf(null, "verbatim"), dryEdit = dryOf(null, "edited");
  const passVerb = cnt(true, "verbatim"), passEdit = cnt(true, "edited"), failVerb = cnt(false, "verbatim"), failEdit = cnt(false, "edited");

  // Automatik-Reife je Anliegen: ≥ 30 unverändert UND ≥ 90 % unverändert (Rolands Regel)
  const byIntent = await db
    .select({ intent: schema.threads.aiIntent, outcome: schema.messages.aiOutcome, n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), eq(schema.messages.direction, "outbound"), isNotNull(schema.messages.aiDraft), gte(schema.messages.createdAt, since)))
    .groupBy(schema.threads.aiIntent, schema.messages.aiOutcome);
  const intents = [...new Set(byIntent.map((r) => r.intent ?? "sonstiges"))].map((k) => {
    const v = byIntent.filter((r) => (r.intent ?? "sonstiges") === k && r.outcome === "verbatim").reduce((a, r) => a + r.n, 0);
    const e = byIntent.filter((r) => (r.intent ?? "sonstiges") === k && r.outcome === "edited").reduce((a, r) => a + r.n, 0);
    return { k, v, e, p: pct(v, v + e), ready: v >= 30 && (pct(v, v + e) ?? 0) >= 90 };
  }).filter((x) => x.v + x.e > 0).sort((a, b) => b.v + b.e - (a.v + a.e));

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>KI-Gehirn · {shopList.find((x) => x.id === shopId)?.name}</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Was die KI aus euren Korrekturen gelernt hat. Vorschläge entstehen automatisch, sobald ihr einen Entwurf ändert. Erst nach „Übernehmen“ gelten sie für jede neue Antwort in diesem Shop.
      </p>

      <div className="report">
        <div className="rstat"><div className="k">Unverändert gesendet (30 T.)</div><div className="v">{pct(verbatim, verbatim + edited) ?? "—"}{verbatim + edited ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{verbatim} von {verbatim + edited} Entwürfen</div></div>
        <div className="rstat"><div className="k">Schattenbetrieb: hätte gepasst</div><div className="v">{pct(shadowOk, shadowAll) ?? "—"}{shadowAll ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{shadowOk} von {shadowAll}</div></div>
        <div className="rstat"><div className="k">KI-Kosten (30 T.)</div><div className="v">{totalEur.toFixed(2).replace(".", ",")} €</div><div className={perMailCt != null && perMailCt > 3 ? "error" : "muted"} style={{ fontSize: 12 }}>{perMailCt != null ? `${perMailCt > 3 ? "⚠ über Limit: " : "ca. "}${perMailCt.toFixed(1).replace(".", ",")} ct pro Mail (Limit 3 ct)` : "noch keine Daten"}{cacheShare != null ? ` · ${cacheShare} % aus Cache` : ""}</div></div>
        <div className="rstat"><div className="k">Ø Dauer Entwurf</div><div className="v">{drafts ? `${(drafts.ms / 1000).toFixed(0)} s` : "—"}</div><div className="muted" style={{ fontSize: 12 }}>läuft im Hintergrund vor dem Öffnen</div></div>
        <div className="rstat"><div className="k">Aktive Regeln</div><div className="v">{active.length}</div></div>
        <div className="rstat"><div className="k">Offene Vorschläge</div><div className="v">{proposals.length}</div></div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Prüfer &amp; Automatik-Reife</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Jeder Entwurf wird geprüft (Fakten + zweite KI). Hier sieht man, ob die Prüfung mit eurem Urteil übereinstimmt. Automatisch senden kommt erst für Anliegen, die belegt reif sind (≥ 30× und ≥ 90 % unverändert).
        </p>
        <div className="report" style={{ marginBottom: 12 }}>
          <div className="rstat"><div className="k">KI wollte allein antworten</div><div className="v">{pct(autoVerb, autoVerb + autoEdit) ?? "—"}{autoVerb + autoEdit ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{autoVerb} von {autoVerb + autoEdit} unverändert gesendet — das zählt für die Automatik</div></div>
          <div className="rstat"><div className="k">KI gab an Mensch ab</div><div className="v">{pct(humVerb, humVerb + humEdit) ?? "—"}{humVerb + humEdit ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{humVerb} von {humVerb + humEdit} Vorschläge unverändert — hier entscheidet ihr (Nachlass, Ersatz, Erstattung)</div></div>
        </div>
        <div className="report">
          <div className="rstat"><div className="k">Bestanden → unverändert</div><div className="v">{pct(passVerb, passVerb + passEdit) ?? "—"}{passVerb + passEdit ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{passVerb} von {passVerb + passEdit} — so oft lag „bestanden“ richtig</div></div>
          <div className="rstat"><div className="k">Trockenlauf Automatik</div><div className="v">{pct(dryVerb, dryVerb + dryEdit) ?? "—"}{dryVerb + dryEdit ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{dryVerb} von {dryVerb + dryEdit} „wäre automatisch gegangen“ wurden unverändert gesendet (Ziel ≥ 95 %)</div></div>
          <div className="rstat"><div className="k">Durchgefallen → geändert</div><div className="v">{pct(failEdit, failEdit + failVerb) ?? "—"}{failEdit + failVerb ? " %" : ""}</div><div className="muted" style={{ fontSize: 12 }}>{failEdit} von {failEdit + failVerb} — Fehler richtig erkannt</div></div>
        </div>
        {intents.length > 0 && (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Anliegen</th><th>Unverändert</th><th>Geändert</th><th>Quote</th><th>Trockenlauf</th><th>Reif?</th></tr></thead>
              <tbody>
                {intents.map((x) => (
                  <tr key={x.k}>
                    <td>{intentLabel(x.k)}</td>
                    <td>{x.v}</td>
                    <td>{x.e}</td>
                    <td>{x.p ?? "—"} %</td>
                    <td>{dryOf(x.k, "verbatim") + dryOf(x.k, "edited") ? `${dryOf(x.k, "verbatim")} von ${dryOf(x.k, "verbatim") + dryOf(x.k, "edited")} unverändert` : <span className="muted">—</span>}</td>
                    <td>{x.ready ? <span className="orderbadge ok">reif</span> : <span className="muted">{Math.max(0, 30 - x.v)} fehlen{(x.p ?? 0) < 90 && x.v + x.e > 0 ? " · Quote < 90 %" : ""}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
