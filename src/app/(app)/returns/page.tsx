import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { expectsReturn, fmtMoney } from "@/server/returns";
import { cancelReturnCase, markReturnTaskDone } from "@/server/actions/returns";
import { ShopSwitcher } from "../inbox/shop-switcher";

const OUTCOME_LABEL: Record<string, string> = {
  deflected_keep: "Behalten",
  refunded: "Erstattet",
  exchanged: "Umtausch",
  returned: "Rücksendung",
  redirected: "An Support",
};

type CaseItem = { title: string; variantTitle: string | null; quantity: number; reasonLabel: string };

export default async function ReturnsPage() {
  const user = await requireUser();
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
        <div className="formhead" style={{ justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>Retouren</h1>
        </div>
        <p className="muted">Kein aktiver Shop.</p>
      </div>
    );
  }
  const caps = await brandAccess(user, activeShopId);
  if (!caps.returns) redirect("/inbox");

  const cases = await db
    .select()
    .from(schema.returnCases)
    .where(eq(schema.returnCases.shopId, activeShopId))
    .orderBy(desc(schema.returnCases.createdAt))
    .limit(50);
  const caseIds = cases.map((c) => c.id);
  const tasks = caseIds.length
    ? await db.select().from(schema.returnTasks).where(inArray(schema.returnTasks.caseId, caseIds))
    : [];
  const tasksByCase = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = tasksByCase.get(t.caseId) ?? [];
    arr.push(t);
    tasksByCase.set(t.caseId, arr);
  }
  const currency = cases[0] ? "EUR" : "EUR";
  const openTasks = tasks.filter((t) => t.status === "pending").length;
  const recovered = cases.reduce((s, c) => s + (c.recoveredValueCents ?? 0), 0);

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Retouren</h1>
        <div className="srcrow">
          <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/returns" />
          <Link href="/returns/intake" className="btnlink">Wareneingang →</Link>
          {caps.settings && <Link href="/returns/settings" className="btnlink">Einstellungen →</Link>}
        </div>
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Fälle (50 neueste)</div><div className="v">{cases.length}</div></div>
          <div className="rstat"><div className="k">Offene Aufgaben</div><div className="v">{openTasks}</div></div>
          <div className="rstat"><div className="k">Zurückgewonnen</div><div className="v">{fmtMoney(recovered, currency)}</div></div>
        </div>
      </section>

      {cases.length === 0 && (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Noch keine Retouren-Fälle. Aktiviere das Portal unter Einstellungen und teile den Portal-Link mit Kunden.
          </p>
        </section>
      )}

      {cases.map((c) => {
        const cTasks = tasksByCase.get(c.id) ?? [];
        const items = (c.items as CaseItem[]) ?? [];
        return (
          <section className="card" key={c.id}>
            <div className="cardhead">
              <h2 style={{ margin: 0 }}>
                #{c.number} · {c.orderName}{" "}
                <span className="disputebadge" style={{ marginLeft: 6 }}>{OUTCOME_LABEL[c.outcome ?? ""] ?? c.status}</span>
              </h2>
              <span className="muted">{c.customerEmail}</span>
            </div>
            <ul className="esc-list" style={{ marginTop: 4 }}>
              {items.map((it, i) => (
                <li key={i}>{it.quantity}× {it.title}{it.variantTitle ? ` (${it.variantTitle})` : ""} — <span className="muted">{it.reasonLabel}</span></li>
              ))}
            </ul>
            {expectsReturn(c.outcome) && (
              <p className="muted" style={{ margin: "2px 0 6px", fontSize: 13 }}>
                {c.receivedAt
                  ? `📦 Eingegangen · ${c.condition === "damaged" ? "beschädigt" : "wiederverkäuflich"}${c.restocked ? " · zurück ins Lager" : ""}`
                  : "📦 Wareneingang ausstehend"}
              </p>
            )}

            {cTasks.length > 0 && (
              <div className="tasklist">
                {cTasks.map((t) => (
                  <div className="taskrow" key={t.id}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div className="muted" style={{ fontSize: 13 }}>{t.instruction}</div>
                    </div>
                    {t.deepLink && (
                      <a href={t.deepLink} target="_blank" rel="noopener noreferrer" className="btnlink">In Shopify öffnen ↗</a>
                    )}
                    {t.status === "done" ? (
                      <span className="muted">✓ erledigt</span>
                    ) : expectsReturn(c.outcome) && !c.receivedAt && t.type === "refund" ? (
                      <span className="muted">⏳ wartet auf Wareneingang</span>
                    ) : (
                      <form action={markReturnTaskDone.bind(null, t.id)}>
                        <button className="btnlink primary" type="submit">Erledigt</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}

            {c.status !== "cancelled" && c.status !== "completed" && (
              <form action={cancelReturnCase.bind(null, c.id)} style={{ marginTop: 8 }}>
                <button className="btnlink" type="submit">Fall abbrechen</button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
