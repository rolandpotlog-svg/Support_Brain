import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { listShopsWithStatus } from "@/server/shop-config";
import { setShopActive } from "@/server/actions/shops";

export default async function ShopsPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");

  const shops = await listShopsWithStatus();

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href="/admin" className="back">← Admin</Link>
        <h1>Shops</h1>
      </div>

      <section className="card">
        <div className="cardhead">
          <h2>Alle Shops</h2>
          <Link href="/admin/shops/new" className="btnlink">+ Shop hinzufügen</Link>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Shopify</th>
              <th>Postfächer</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shops.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/admin/shops/${s.id}`}>{s.name}</Link>
                  <div className="muted" style={{ fontSize: 12 }}>{s.slug}</div>
                </td>
                <td>
                  <span className={`sbadge ${s.active ? "paid" : "unpaid"}`}>
                    {s.active ? "aktiv" : "inaktiv"}
                  </span>
                </td>
                <td>
                  <span className={s.shopifyConfigured ? "ok-text" : "bad-text"}>
                    {s.shopifyConfigured ? "✓ verbunden" : "✗ fehlt"}
                  </span>
                </td>
                <td>
                  <span className={s.mailboxCount > 0 ? "ok-text" : "bad-text"}>
                    {s.mailboxCount > 0 ? `✓ ${s.mailboxCount}` : "✗ keine"}
                  </span>
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  <Link href={`/admin/shops/${s.id}`} className="btnlink">Bearbeiten</Link>
                  <form action={setShopActive.bind(null, s.id, !s.active)}>
                    <button type="submit" className={s.active ? "warn" : ""}>
                      {s.active ? "deaktivieren" : "aktivieren"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {shops.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">Noch keine Shops. „+ Shop hinzufügen".</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
