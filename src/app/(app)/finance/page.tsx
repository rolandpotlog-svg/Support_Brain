// Finance/Controlling — eigenes, klar abgegrenztes Modul (eigene Route, eigenes
// Permission-Gate finance_access). Bewusst entfernbar, ohne Support zu berühren.
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { ShopSwitcher } from "../inbox/shop-switcher";

export default async function FinancePage() {
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
  // Harte Server-Sperre: ohne finance_access (oder Owner) gibt es hier KEINE Daten.
  if (!activeShopId || !(await brandAccess(user, activeShopId)).finance) redirect("/inbox");

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Finance / Controlling</h1>
        <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/finance" />
      </div>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Modul-Gerüst</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          Eigenes Modul mit eigenem Recht (<code>finance_access</code>). Sichtbar nur für Owner und Mitglieder
          mit Finance-Freigabe auf diesem Brand. Hier kommen später Umsatz-, Kosten- und Controlling-Daten rein —
          sauber entfernbar, ohne den Support-Teil zu berühren.
        </p>
      </section>
    </div>
  );
}
