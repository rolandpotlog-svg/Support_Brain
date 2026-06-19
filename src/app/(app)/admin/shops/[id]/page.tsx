import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { loadShopForEdit } from "@/server/shop-config";
import { ShopForm } from "../shop-form";

export default async function EditShopPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");
  const { id } = await params;
  const shop = await loadShopForEdit(id);
  if (!shop) notFound();
  return (
    <div className="adminwrap">
      <ShopForm initial={shop} />
    </div>
  );
}
