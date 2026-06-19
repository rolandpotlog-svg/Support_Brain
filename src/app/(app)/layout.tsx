import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { IconRail } from "./icon-rail";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="shell">
      <IconRail isAdmin={session.user.role === "admin"} />
      <div className="workspace">{children}</div>
    </div>
  );
}
