import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { loadShopForEdit } from "@/server/shop-config";
import { loadProfile } from "@/server/profile";
import { ShopForm } from "../shop-form";
import { ProfileForm } from "../profile-form";

export default async function EditShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");
  const { id } = await params;
  const { tab } = await searchParams;
  const shop = await loadShopForEdit(id);
  if (!shop) notFound();

  const activeTab = tab === "profil" ? "profil" : "zugang";
  const profile = activeTab === "profil" ? await loadProfile(id) : null;

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href="/admin/shops" className="back">← Shops</Link>
        <h1>{shop.name}</h1>
      </div>

      <div className="tabnav">
        <Link href={`/admin/shops/${id}`} className={activeTab === "zugang" ? "active" : ""}>
          Zugang
        </Link>
        <Link href={`/admin/shops/${id}?tab=profil`} className={activeTab === "profil" ? "active" : ""}>
          Shop-Profil
        </Link>
      </div>

      {activeTab === "zugang" ? (
        <ShopForm initial={shop} hideHead />
      ) : (
        <ProfileForm
          shopId={id}
          shopName={shop.name}
          shopifyConfigured={shop.shopify.configured}
          initial={profile!}
        />
      )}
    </div>
  );
}
