import { redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { IconRail } from "./icon-rail";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  return (
    <div className="shell">
      <IconRail
        canReports={user.canReports}
        canCases={user.canCases}
        canAdmin={user.canShopsView || user.canManageUsers}
      />
      <div className="workspace">{children}</div>
    </div>
  );
}
