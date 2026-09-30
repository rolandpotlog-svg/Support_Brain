import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, brandAccess, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { createUser, resetUserPassword, setUserActive, setUserOwner } from "@/server/actions/admin";
import { MembershipForm } from "./membership-form";
import { Maintenance } from "./maintenance";

export default async function AdminPage() {
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);
  const activeShopId = await getActiveShopId(accessible);
  const caps = activeShopId ? await brandAccess(user, activeShopId) : null;
  if (!user.isOwner && !(caps?.settings || caps?.manageUsers)) redirect("/inbox");

  // Trennung: Nicht-Owner sehen nur ihre eigenen Shops (auch in der Eskalations-Liste unten).
  const visibleShopIds = user.isOwner ? null : accessible;
  const shops = await db
    .select()
    .from(schema.shops)
    .where(visibleShopIds ? inArray(schema.shops.id, visibleShopIds.length ? visibleShopIds : ["00000000-0000-0000-0000-000000000000"]) : undefined)
    .orderBy(schema.shops.name);
  const shopName = new Map(shops.map((s) => [s.id, s.name]));
  const users = user.isOwner ? await db.select().from(schema.users).orderBy(schema.users.createdAt) : [];
  const memberships = user.isOwner ? await db.select().from(schema.userShops) : [];
  const byUser = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const arr = byUser.get(m.userId) ?? [];
    arr.push(m);
    byUser.set(m.userId, arr);
  }

  const escalations = await db
    .select({
      id: schema.escalations.id,
      threadId: schema.escalations.threadId,
      reason: schema.escalations.reason,
      subject: schema.threads.subject,
      customerEmail: schema.threads.customerEmail,
      shopName: schema.shops.name,
    })
    .from(schema.escalations)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.escalations.threadId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.threads.shopId))
    .where(
      and(
        eq(schema.escalations.status, "open"),
        visibleShopIds ? inArray(schema.threads.shopId, visibleShopIds.length ? visibleShopIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    )
    .orderBy(desc(schema.escalations.createdAt));

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      {user.isOwner && (
        <section className="card">
          <h2>Wartung — Speicher</h2>
          <Maintenance />
        </section>
      )}

      {(user.isOwner || caps?.settings) && (
        <section className="card">
          <div className="cardhead">
            <h2>Brands</h2>
            <Link href="/admin/shops" className="btnlink">Brands verwalten →</Link>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {shops.length === 0 ? "Noch keine Brands angelegt." : `${shops.length} Brand(s).`}
          </p>
        </section>
      )}

      <section className="card">
        <h2>Eskalations-Queue</h2>
        {escalations.length === 0 && <p className="muted">Nichts offen.</p>}
        <ul className="esc-list">
          {escalations.map((e) => (
            <li key={e.id}>
              <Link href={`/inbox?ticket=${e.threadId}`}>{e.subject || "(kein Betreff)"}</Link>
              <span className="muted"> · {e.shopName} · {e.customerEmail}</span>
              {e.reason && <div className="muted">„{e.reason}"</div>}
            </li>
          ))}
        </ul>
      </section>

      {user.isOwner && (
        <>
          <section className="card">
            <h2>Neuen Login anlegen</h2>
            <form className="invite" action={createUser}>
              <input name="email" type="email" placeholder="E-Mail" required />
              <input name="name" placeholder="Name (optional)" />
              <input name="password" type="text" placeholder="Start-Passwort" required />
              <label className="chk">
                <input type="checkbox" name="isOwner" />
                Owner (Vollzugriff auf alle Brands)
              </label>
              <button className="primary" type="submit">Login anlegen</button>
            </form>
            <p className="muted" style={{ marginTop: 8 }}>
              Danach unten pro Brand eine Rolle zuweisen (Founder/Admin/Mitarbeiter/Gast) und ggf. Finance freigeben.
            </p>
          </section>

          <section className="card">
            <h2>Nutzer &amp; Brand-Rollen</h2>
            <div className="userlist">
              {users.map((u) => {
                const mine = byUser.get(u.id) ?? [];
                const assignedIds = new Set(mine.map((m) => m.shopId));
                const free = shops.filter((s) => !assignedIds.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
                return (
                  <div key={u.id} className="usercard">
                    <div className="userhead">
                      <strong>{u.name || u.email}</strong>
                      <span className="muted"> · {u.email} {u.role === "owner" ? "· 👑 Owner" : ""} {u.active ? "" : "· inaktiv"}</span>
                    </div>
                    <div className="userform" style={{ marginBottom: 8 }}>
                      <form action={setUserOwner}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="isOwner" value={u.role === "owner" ? "" : "on"} />
                        <button className="btnlink" type="submit">{u.role === "owner" ? "Owner entziehen" : "Zum Owner machen"}</button>
                      </form>
                      <form action={setUserActive}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="active" value={u.active ? "" : "on"} />
                        <button className="btnlink" type="submit">{u.active ? "Deaktivieren" : "Aktivieren"}</button>
                      </form>
                      <form action={resetUserPassword} className="userform">
                        <input type="hidden" name="userId" value={u.id} />
                        <input name="password" type="text" placeholder="Neues Passwort" />
                        <button className="btnlink" type="submit">Passwort setzen</button>
                      </form>
                    </div>

                    {u.role === "owner" ? (
                      <p className="muted" style={{ margin: 0 }}>Owner hat automatisch Vollzugriff auf alle Brands (inkl. Finance).</p>
                    ) : (
                      <>
                        {mine.map((m) => (
                          <MembershipForm
                            key={m.shopId}
                            userId={u.id}
                            shopId={m.shopId}
                            shopName={shopName.get(m.shopId) ?? "?"}
                            role={m.role}
                            finance={m.financeAccess}
                          />
                        ))}
                        {free.length > 0 && <MembershipForm userId={u.id} brands={free} />}
                        {mine.length === 0 && free.length === 0 && (
                          <p className="muted" style={{ margin: 0 }}>Keine Brands vorhanden.</p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
