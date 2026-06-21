import { notFound } from "next/navigation";
import { loadPortalShop } from "@/server/returns";
import { ReturnPortal } from "./portal";

export const dynamic = "force-dynamic";

export default async function ReturnPortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await loadPortalShop(slug);
  if (!shop) notFound();
  return (
    <ReturnPortal
      slug={slug}
      shopName={shop.shopName}
      accentColor={shop.accentColor}
      currency={shop.currency}
    />
  );
}
