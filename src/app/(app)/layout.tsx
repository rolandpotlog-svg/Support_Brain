import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser, type SessionUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { shopColor } from "@/lib/shop-color";
import { IconRail } from "./icon-rail";
import { FeedbackWidget } from "./feedback-widget";
import { ActivityPing } from "./activity-ping";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const accessible = await accessibleShopIds(user);
  // Nur AKTIVE Shops — genau wie die Seiten selbst. Sonst zeigt die Leiste einen anderen Shop als die Seite.
  const shopRows =
    accessible.length > 0
      ? await db
          .select({ id: schema.shops.id, name: schema.shops.name, slug: schema.shops.slug })
          .from(schema.shops)
          .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
          .orderBy(asc(schema.shops.name))
      : [];
  const shops = shopRows.map((s) => ({ id: s.id, name: s.name, color: shopColor(s.slug) }));
  const activeShopId = await getActiveShopId(shops.map((s) => s.id));
  const active = shops.find((s) => s.id === activeShopId) ?? null;
  const caps = activeShopId ? await brandAccess(user, activeShopId) : null;

  return (
    <div className="shell">
      <IconRail
        shops={shops}
        activeShopId={activeShopId}
        isOwner={user.isOwner}
        canReports={!!caps?.reports}
        canCases={!!caps?.cases}
        canReturns={!!caps?.returns}
        canAdmin={user.isOwner || !!caps?.settings}
      />
      <div className="workspace-wrap" style={{ ["--shop" as string]: active?.color ?? "var(--accent)" }}>
        {/* Shop-Leiste: immer sichtbar, in Shop-Farbe — man sieht jederzeit, in welchem Shop man arbeitet. */}
        {active && (
          <div className="shopstrip">
            <span className="shopstrip-dot" />
            <strong>{active.name}</strong>
            {shops.length > 1 && <span className="shopstrip-hint">aktiver Shop · Wechsel links oben</span>}
          </div>
        )}
        <div className="workspace">{children}</div>
      </div>
      <FeedbackWidget />
      <ActivityPing />
    </div>
  );
}
