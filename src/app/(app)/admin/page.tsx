import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/access";
import { createUser, resetUserPassword, updateUser } from "@/server/actions/admin";

const PERMS: { key: string; label: string }[] = [
  { key: "permReports", label: "Auswertung" },
  { key: "permCases", label: "Fälle" },
  { key: "permShopsView", label: "Shops ansehen" },
  { key: "permShopsEdit", label: "Shops verwalten" },
  { key: "permManageUsers", label: "Nutzer verwalten" },
];

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.canManageUsers && !user.canShopsView) redirect("/inbox");

  const shops = await db.select().from(schema.shops).orderBy(schema.shops.name);
  const users = await db.select().from(schema.users).orderBy(schema.users.createdAt);
  const assignments = await db.select().from(schema.userShops);
  const shopsByUser = new Map<string, number>();
  for (const a of assignments) shopsByUser.set(a.userId, (shopsByUser.get(a.userId) ?? 0) + 1);

  const escalations = await db
    .select({
      id: schema.escalations.id,
      threadId: schema.escalations.threadId,
      reason: schema.escalations.reason,
      createdAt: schema.escalations.createdAt,
      subject: schema.threads.subject,
      customerEmail: schema.threads.customerEmail,
      shopName: schema.shops.name,
    })
    .from(schema.escalations)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.escalations.threadId))
    .innerJoin(schema.shops, eq(schema.shops.id, schema.threads.shopId))
    .where(eq(schema.escalations.status, "open"))
    .orderBy(desc(schema.escalations.createdAt));

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      {user.canShopsView && (
        <section className="card">
          <div className="cardhead">
            <h2>Shops</h2>
            <Link href="/admin/shops" className="btnlink">Shops verwalten →</Link>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {shops.length === 0
              ? "Noch keine Shops angelegt."
              : `${shops.length} Shop(s). Zugänge (Shopify, Postfächer) unter „Shops verwalten".`}
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

      {user.canManageUsers && (
        <>
          <section className="card">
            <h2>Neuen Login anlegen</h2>
            <form className="invite" action={createUser}>
              <input name="email" type="email" placeholder="E-Mail" required />
              <input name="name" placeholder="Name (optional)" />
              <input name="password" type="text" placeholder="Start-Passwort" required />
              <select name="role" defaultValue="member">
                <option value="member">Mitglied (Mitarbeiter/Founder)</option>
                {user.isOwner && <option value="owner">Owner (volle Kontrolle)</option>}
              </select>
              <fieldset>
                <legend>Rechte freischalten</legend>
                {PERMS.map((p) => (
                  <label key={p.key} className="chk">
                    <input type="checkbox" name={p.key} disabled={p.key === "permManageUsers" && !user.isOwner} />
                    {p.label}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Shops (für Posteingang-Zuweisung)</legend>
                {shops.length === 0 && <span className="muted">Noch keine Shops.</span>}
                {shops.map((s) => (
                  <label key={s.id} className="chk">
                    <input type="checkbox" name="shopIds" value={s.id} />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <button className="primary" type="submit">Login anlegen</button>
            </form>
          </section>

          <section className="card">
            <h2>Nutzer &amp; Rechte</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Owner hat automatisch alle Rechte. Bei Mitgliedern schaltest du einzelne Bereiche frei.
            </p>
            <div className="userlist">
              {users.map((u) => {
                const editableByMe = user.isOwner || u.role !== "owner";
                return (
                  <div key={u.id} className="usercard">
                    <div className="userhead">
                      <strong>{u.name || u.email}</strong>
                      <span className="muted"> · {u.email} · {u.role === "owner" ? "Owner" : "Mitglied"} · Shops: {u.role === "owner" ? "alle" : (shopsByUser.get(u.id) ?? 0)}</span>
                    </div>
                    {editableByMe ? (
                      <>
                        <form action={updateUser} className="userform">
                          <input type="hidden" name="userId" value={u.id} />
                          <select name="role" defaultValue={u.role}>
                            <option value="member">Mitglied</option>
                            {user.isOwner && <option value="owner">Owner</option>}
                          </select>
                          {PERMS.map((p) => (
                            <label key={p.key} className="chk">
                              <input
                                type="checkbox"
                                name={p.key}
                                defaultChecked={Boolean((u as unknown as Record<string, boolean>)[p.key])}
                                disabled={u.role === "owner" || (p.key === "permManageUsers" && !user.isOwner)}
                              />
                              {p.label}
                            </label>
                          ))}
                          <label className="chk">
                            <input type="checkbox" name="active" defaultChecked={u.active} />
                            Aktiv
                          </label>
                          <button className="btnlink primary" type="submit">Speichern</button>
                        </form>
                        <form action={resetUserPassword} className="userform" style={{ marginTop: 6 }}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input name="password" type="text" placeholder="Neues Passwort setzen" />
                          <button className="btnlink" type="submit">Passwort zurücksetzen</button>
                        </form>
                      </>
                    ) : (
                      <div className="muted">Owner — nur ein Owner darf einen Owner bearbeiten.</div>
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
