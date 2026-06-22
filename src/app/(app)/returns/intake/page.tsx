import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { listPendingIntake } from "@/server/returns";
import { receiveReturnForm } from "@/server/actions/returns";
import { ShopSwitcher } from "../../inbox/shop-switcher";

type CaseItem = { title: string; variantTitle: string | null; quantity: number };

export default async function ReturnIntakePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = q ?? "";

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
        <h1 style={{ marginTop: 0 }}>Wareneingang</h1>
        <p className="muted">Kein aktiver Shop.</p>
      </div>
    );
  }

  if (!(await brandAccess(user, activeShopId)).returns) redirect("/inbox");

  const pending = await listPendingIntake(activeShopId, query);

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Wareneingang</h1>
        <div className="srcrow">
          <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/returns/intake" />
          <Link href="/returns" className="btnlink">← Zu den Fällen</Link>
        </div>
      </div>

      <section className="card">
        <form method="get" className="srcrow">
          <input name="q" defaultValue={query} placeholder="Name oder Bestellnummer vom Paket…" style={{ flex: 1, minWidth: 240 }} />
          <button className="btnlink primary" type="submit">Suchen</button>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          {pending.length} offene Rücksendung(en){query ? ` für „${query}"` : ""}. Bestellnummer ist am zuverlässigsten.
        </p>
      </section>

      {pending.length === 0 && (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>Keine offenen Wareneingänge.</p>
        </section>
      )}

      {pending.map((c) => {
        const items = (c.items as CaseItem[]) ?? [];
        return (
          <section className="card" key={c.id}>
            <div className="cardhead">
              <h2 style={{ margin: 0 }}>#{c.number} · {c.orderName}</h2>
              <span className="muted">{c.customerName || c.customerEmail}</span>
            </div>
            <ul className="esc-list" style={{ marginTop: 4 }}>
              {items.map((it, i) => (
                <li key={i}>{it.quantity}× {it.title}{it.variantTitle ? ` (${it.variantTitle})` : ""}</li>
              ))}
            </ul>
            <form action={receiveReturnForm} className="userform" style={{ marginTop: 8 }}>
              <input type="hidden" name="caseId" value={c.id} />
              <label className="field" style={{ minWidth: 200 }}>
                <span className="fieldlabel">Zustand</span>
                <select name="condition" defaultValue="resaleable">
                  <option value="resaleable">Wiederverkäuflich</option>
                  <option value="damaged">Beschädigt</option>
                </select>
              </label>
              <label className="chk">
                <input type="checkbox" name="restock" defaultChecked />
                Zurück ins Lager (Restock)
              </label>
              <button className="btnlink primary" type="submit">Eingegangen buchen</button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
