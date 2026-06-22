import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { getSettings } from "@/server/returns";
import { ShopSwitcher } from "../../inbox/shop-switcher";
import { ReturnsSettingsForm } from "./settings-form";

export default async function ReturnsSettingsPage() {
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name, slug: schema.shops.slug })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  const shop = shopList.find((s) => s.id === activeShopId);

  if (!activeShopId || !shop) {
    return (
      <div className="adminwrap">
        <h1 style={{ marginTop: 0 }}>Retouren-Einstellungen</h1>
        <p className="muted">Kein aktiver Shop.</p>
      </div>
    );
  }
  if (!(await brandAccess(user, activeShopId)).settings) redirect("/returns");

  const settings = await getSettings(activeShopId);
  const reasons = await db
    .select()
    .from(schema.returnReasons)
    .where(eq(schema.returnReasons.shopId, activeShopId))
    .orderBy(schema.returnReasons.sortOrder);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Retouren-Einstellungen</h1>
        <div className="srcrow">
          <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/returns/settings" />
          <Link href="/returns" className="btnlink">← Zu den Fällen</Link>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Portal-Link</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Diesen Link auf deiner Website/in der Versandbestätigung verlinken (z. B. „Rückgabe starten").
        </p>
        <code style={{ fontSize: 14 }}>{appUrl}/r/{shop.slug}</code>
      </section>

      <ReturnsSettingsForm
        shopId={activeShopId}
        slug={shop.slug}
        initial={{
          enabled: settings?.enabled ?? false,
          cogsPct: settings?.cogsPct ?? 40,
          returnShippingEuros: (settings?.returnShippingCents ?? 600) / 100,
          resaleableDefault: settings?.resaleableDefault ?? true,
          voucherBonusPct: settings?.voucherBonusPct ?? 15,
          firstOfferPct: settings?.firstOfferPct ?? 70,
          fraudWindowDays: settings?.fraudWindowDays ?? 60,
          fraudMaxKeepEuros: (settings?.fraudMaxKeepCents ?? 10000) / 100,
          highValueThresholdEuros: (settings?.highValueThresholdCents ?? 15000) / 100,
          accentColor: settings?.accentColor ?? "#2b6ef2",
        }}
        reasons={reasons.map((r) => ({ label: r.label, routing: r.routing, active: r.active }))}
      />
    </div>
  );
}
