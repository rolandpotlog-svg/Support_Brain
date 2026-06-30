// Textbausteine verwalten (support-Cap). Im Posteingang einfügbar.
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { listCannedReplies } from "@/server/canned";
import { CannedManage } from "./manage";

export default async function TextbausteinePage() {
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const shopList = accessible.length
    ? await db.select({ id: schema.shops.id, name: schema.shops.name }).from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true))).orderBy(schema.shops.name)
    : [];
  const activeShopId = await getActiveShopId(shopList.map((s) => s.id));
  if (!activeShopId || !(await brandAccess(user, activeShopId)).support) redirect("/inbox");

  const items = await listCannedReplies(activeShopId);

  return (
    <div className="adminwrap">
      <div className="formhead" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Textbausteine</h1>
        <Link href="/inbox" className="btnlink">← Zum Posteingang</Link>
      </div>
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Schnellantworten für den Posteingang. Im Antwort-Feld über <b>„＋ Textbaustein…"</b> einfügbar.
        </p>
        <CannedManage shopId={activeShopId} items={items} />
      </section>
    </div>
  );
}
