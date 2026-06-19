import { redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { ShopForm } from "../shop-form";

export default async function NewShopPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");
  return (
    <div className="adminwrap">
      <ShopForm initial={null} />
    </div>
  );
}
