import { redirect } from "next/navigation";
import { asc, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser, type SessionUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { IconRail } from "./icon-rail";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const accessible = await accessibleShopIds(user);
  const activeShopId = await getActiveShopId(accessible);
  const caps = activeShopId ? await brandAccess(user, activeShopId) : null;
  const shops =
    accessible.length > 0
      ? await db
          .select({ id: schema.shops.id, name: schema.shops.name })
          .from(schema.shops)
          .where(inArray(schema.shops.id, accessible))
          .orderBy(asc(schema.shops.name))
      : [];

  return (
    <div className="shell">
      <IconRail
        shops={shops}
        activeShopId={activeShopId}
        canReports={!!caps?.reports}
        canCases={!!caps?.cases}
        canReturns={!!caps?.returns}
        canFinance={!!caps?.finance}
        canAdmin={user.isOwner || !!caps?.settings}
      />
      <div className="workspace">{children}</div>
    </div>
  );
}
