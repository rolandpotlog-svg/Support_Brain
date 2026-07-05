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
        <h1 style={{ margin: 0 }}>Schnellantworten (KI)</h1>
        <Link href="/inbox" className="btnlink">← Zum Posteingang</Link>
      </div>
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Kein starrer Text mehr — du hinterlegst eine <b>Absicht</b>, und die KI schreibt daraus im
          Posteingang eine echte, markengerechte Mail (mit Kundenname, Bestellbezug, Ton und Signatur).
          Im Antwort-Feld über <b>„⚡ Schnellantwort (KI)…"</b> auswählbar.
        </p>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Beispiele: <b>10 % Rabatt anbieten</b> → „Biete dem Kunden 10 % Rabatt auf seine aktuelle
          Bestellung an, damit er zufrieden ist." · <b>30 % fürs Behalten</b> → „Biete 30 % Erstattung an,
          wenn der Kunde das Produkt behält statt es zurückzuschicken." · <b>Sendung unterwegs</b> →
          „Beruhige den Kunden, dass die Sendung unterwegs ist, und nenne den Status/Tracking."
        </p>
        <CannedManage shopId={activeShopId} items={items} />
      </section>
    </div>
  );
}
