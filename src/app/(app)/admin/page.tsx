import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/access";
import { createUser } from "@/server/actions/admin";

export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");

  const shops = await db.select().from(schema.shops).orderBy(schema.shops.name);
  const users = await db.select().from(schema.users).orderBy(schema.users.createdAt);
  const assignments = await db.select().from(schema.userShops);
  const shopsByUser = new Map<string, number>();
  for (const a of assignments) {
    shopsByUser.set(a.userId, (shopsByUser.get(a.userId) ?? 0) + 1);
  }

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

      <section className="card">
        <h2>Eskalations-Queue</h2>
        {escalations.length === 0 && <p className="muted">Nichts offen.</p>}
        <ul className="esc-list">
          {escalations.map((e) => (
            <li key={e.id}>
              <Link href={`/inbox?ticket=${e.threadId}`}>{e.subject || "(kein Betreff)"}</Link>
              <span className="muted">
                {" "}· {e.shopName} · {e.customerEmail}
              </span>
              {e.reason && <div className="muted">„{e.reason}"</div>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Neuen Login anlegen</h2>
        <form className="invite" action={createUser}>
          <input name="email" type="email" placeholder="E-Mail" required />
          <input name="name" placeholder="Name (optional)" />
          <input name="password" type="text" placeholder="Start-Passwort" required />
          <select name="role" defaultValue="agent">
            <option value="agent">Agent (Support)</option>
            <option value="admin">Admin (Geschäftsführung)</option>
          </select>
          <fieldset>
            <legend>Shops (für Agents)</legend>
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
        <h2>Nutzer</h2>
        <table>
          <thead>
            <tr>
              <th>E-Mail</th>
              <th>Name</th>
              <th>Rolle</th>
              <th>Shops</th>
              <th>Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.name || "—"}</td>
                <td>{u.role}</td>
                <td>{u.role === "admin" ? "alle" : (shopsByUser.get(u.id) ?? 0)}</td>
                <td>{u.active ? "ja" : "nein"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
