// Produkt-Analyse: welche Produkte machen welche Probleme — und welche werden gelobt. Je Shop getrennt.
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { productInsights } from "@/server/product-insights";

const STATUS_LABEL = { rot: "handeln", gelb: "beobachten", gruen: "ok" } as const;

export default async function ProduktePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const { d } = await searchParams;
  const days = d === "90" ? 90 : d === "7" ? 7 : 30;
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id }).from(schema.shops).where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
    : [];
  const shopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!shopId || !(await brandAccess(user, shopId)).reports) redirect("/inbox");

  const { rows, unassigned } = await productInsights(shopId, days);
  const red = rows.filter((r) => r.status === "rot").length;
  const praised = [...rows].filter((r) => r.praise > 0).sort((a, b) => b.praise - a.praise).slice(0, 5);

  return (
    <div className="adminwrap" style={{ maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Produkte</h1>
        <span className="spacer" style={{ flex: 1 }} />
        <div className="queues" style={{ border: 0, padding: 0 }}>
          {[7, 30, 90].map((x) => (
            <Link key={x} href={`/produkte?d=${x}`} className={`qchip ${days === x ? "on" : ""}`}>{x} Tage</Link>
          ))}
        </div>
        <a className="btnlink primary" href={`/produkte/export?shop=${shopId}&d=${days}`}>⬇ Supplier-Liste (Excel)</a>
      </div>
      <p className="muted">
        Automatisch aus jeder Kundenmail (Problem + betroffener Artikel aus der zugeordneten Bestellung), aus Retouren und Reklamationen.
        {red > 0 ? <> <b style={{ color: "var(--tag-rose-fg)" }}>{red} Produkt(e) mit Handlungsbedarf.</b></> : null}
        {unassigned > 0 ? <> · {unassigned} Problem-Ticket(s) ohne erkannten Artikel.</> : null}
      </p>

      {praised.length > 0 && (
        <section className="card" style={{ padding: "12px 16px" }}>
          <b>Kommt gut an:</b>{" "}
          {praised.map((p) => <span key={p.product} className="ichip i-lob" style={{ marginRight: 6 }}>{p.product} · {p.praise}× Lob</span>)}
        </section>
      )}

      <section className="card" style={{ padding: 0 }}>
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: 16 }}>Noch keine Daten im Zeitraum. Sobald Mails eingeordnet sind, erscheinen die Produkte hier.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="prodtable">
              <thead>
                <tr>
                  <th></th><th>Produkt</th><th>Probleme</th><th>Häufigste Probleme</th><th>Retouren</th><th>Reklam.</th><th>Lob</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product}>
                    <td><span className={`amp amp-${r.status}`} title={STATUS_LABEL[r.status]} /></td>
                    <td>
                      <details>
                        <summary className="prodname">{r.product}</summary>
                        <div className="prod-detail">
                          {r.issues.map((i) => (
                            <div key={i.issue} className="prod-issue">
                              <b>{i.issue}</b> · {i.n}× {i.prev ? <span className="muted">(vorher {i.prev}×)</span> : null}
                              <ul>
                                {i.examples.map((e) => (
                                  <li key={e.threadId}><Link href={`/inbox?ticket=${e.threadId}`}>#{e.number}</Link> {e.summary}</li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          {r.returnReasons.length > 0 && (
                            <div className="prod-issue"><b>Retourengründe:</b> {r.returnReasons.map((x) => `${x.reason} (${x.n})`).join(" · ")}</div>
                          )}
                        </div>
                      </details>
                    </td>
                    <td className="num">
                      <b>{r.problems}</b>
                      {r.problemsPrev || r.problems ? (
                        <span className={`trend ${r.problems > r.problemsPrev ? "up" : r.problems < r.problemsPrev ? "down" : ""}`}>
                          {r.problems > r.problemsPrev ? "▲" : r.problems < r.problemsPrev ? "▼" : "="} {r.problemsPrev}
                        </span>
                      ) : null}
                    </td>
                    <td>{r.issues.slice(0, 3).map((i) => <span key={i.issue} className="ichip i-defekt" style={{ marginRight: 4 }}>{i.issue} · {i.n}</span>)}</td>
                    <td className="num">{r.returns || "—"}</td>
                    <td className="num">{r.claims || "—"}</td>
                    <td className="num">{r.praise || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
