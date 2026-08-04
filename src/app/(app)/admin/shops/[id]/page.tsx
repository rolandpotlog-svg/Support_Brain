import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { brandAccess, requireUser } from "@/server/access";
import { loadShopForEdit } from "@/server/shop-config";
import { loadProfile } from "@/server/profile";
import { loadSocialAccounts } from "@/server/social-config";
import { ShopForm } from "../shop-form";
import { ProfileForm } from "../profile-form";
import { SocialConfig } from "../social-config";
import { LoadDefaults } from "../load-defaults";

export default async function EditShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; shopify?: string; shopify_error?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  if (!(await brandAccess(user, id)).settings) redirect("/inbox");
  const { tab, shopify, shopify_error } = await searchParams;
  const shop = await loadShopForEdit(id);
  if (!shop) notFound();

  const activeTab = tab === "profil" ? "profil" : tab === "social" ? "social" : "zugang";
  const profile = activeTab === "profil" ? await loadProfile(id) : null;
  const social = activeTab === "social" ? await loadSocialAccounts(id) : null;

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href="/admin/shops" className="back">← Shops</Link>
        <h1>{shop.name}</h1>
      </div>

      {shopify === "ok" && (
        <div className="formerror" style={{ background: "#dcfce7", color: "#166534" }}>
          ✓ Shopify autorisiert — Token gespeichert. „Verbindung testen" zur Kontrolle.
        </div>
      )}
      {shopify_error && <div className="formerror">Shopify-OAuth-Fehler: {shopify_error}</div>}

      <div className="tabnav">
        <Link href={`/admin/shops/${id}`} className={activeTab === "zugang" ? "active" : ""}>
          Zugang
        </Link>
        <Link href={`/admin/shops/${id}?tab=profil`} className={activeTab === "profil" ? "active" : ""}>
          Shop-Profil
        </Link>
        <Link href={`/admin/shops/${id}?tab=social`} className={activeTab === "social" ? "active" : ""}>
          Social (Meta)
        </Link>
      </div>

      {activeTab === "zugang" && <ShopForm initial={shop} hideHead />}
      {activeTab === "profil" && <LoadDefaults shopId={id} />}
      {activeTab === "profil" && (
        <ProfileForm
          shopId={id}
          shopName={shop.name}
          shopifyConfigured={shop.shopify.configured}
          initial={profile!}
        />
      )}
      {activeTab === "social" && <SocialConfig shopId={id} accounts={social!} />}
    </div>
  );
}
