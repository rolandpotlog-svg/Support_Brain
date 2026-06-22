import { redirect } from "next/navigation";
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

  return (
    <div className="shell">
      <IconRail
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
