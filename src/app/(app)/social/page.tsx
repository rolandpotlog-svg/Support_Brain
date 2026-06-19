import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { listConversations, loadConversation } from "@/server/social";
import { initials, timeAgo } from "@/lib/format";
import { ShopSwitcher } from "../inbox/shop-switcher";
import { SocialReply } from "./social-reply";
import { SocialMatch } from "./social-match";

const WINDOW_MS = 24 * 3_600_000;

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);

  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeIds = shopList.map((s) => s.id);

  let activeShopId = await getActiveShopId(activeIds);
  let selected: Awaited<ReturnType<typeof loadConversation>> = null;
  if (c) {
    const data = await loadConversation(c);
    if (data && activeIds.includes(data.conv.shopId)) {
      selected = data;
      activeShopId = data.conv.shopId;
    }
  }
  const hasShops = activeShopId !== null;
  const conversations = activeShopId ? await listConversations(activeShopId) : [];

  const withinWindow = selected?.conv.lastInboundAt
    ? Date.now() - selected.conv.lastInboundAt.getTime() < WINDOW_MS
    : false;

  return (
    <>
      <section className="tickets">
        <div className="head">
          <span className="title"><span className="play">▶</span> Social</span>
          {hasShops && activeShopId && (
            <span style={{ marginLeft: "auto" }}>
              <ShopSwitcher shops={shopList} activeId={activeShopId} redirectTo="/social" />
            </span>
          )}
        </div>
        <div className="list">
          {conversations.map((cv) => (
            <Link key={cv.id} href={`/social?c=${cv.id}`} className={`tcard ${cv.id === c ? "active" : ""}`}>
              <div className="top">
                <span className="avatar">{initials(cv.userName, cv.channel)}</span>
                <span className="name">{cv.userName || "Unbekannt"}</span>
                <span className="time">{timeAgo(new Date(cv.lastMessageAt))}</span>
              </div>
              <div className="bottom">
                <span className="sbadge">{cv.channel === "instagram" ? "Instagram" : "Facebook"}</span>
                {cv.customerName && <span className="muted"> · {cv.customerName}</span>}
              </div>
            </Link>
          ))}
          {conversations.length === 0 && (
            <p className="muted" style={{ padding: 12 }}>
              {hasShops ? "Noch keine Social-Nachrichten." : "Noch kein Shop angelegt (Admin)."}
            </p>
          )}
        </div>
      </section>

      {selected ? (
        <section className="convo">
          <div className="chead">
            <h2>{selected.conv.userName || "Unbekannt"}</h2>
            <span className={`sbadge ${withinWindow ? "paid" : "unpaid"}`}>
              {withinWindow ? "24-h-Fenster offen" : "außerhalb 24-h-Fenster"}
            </span>
          </div>
          <div className="body">
            {selected.messages.map((m) => (
              <article key={m.id} className={`mail ${m.direction}`}>
                <div className="mhead">
                  <div className="mavatar">
                    {m.direction === "inbound" ? initials(selected.conv.userName, "?") : "S"}
                  </div>
                  <div>
                    <div className="mfrom">
                      {m.direction === "inbound" ? selected.conv.userName || "Kunde" : "Support"}
                    </div>
                  </div>
                  <div className="mtime">{timeAgo(new Date(m.createdAt))}</div>
                </div>
                <pre className="mbody">{m.text || ""}</pre>
              </article>
            ))}
            {selected.messages.length === 0 && <div className="empty">Noch keine Nachrichten.</div>}
          </div>
          <SocialReply convId={selected.conv.id} userName={selected.conv.userName} withinWindow={withinWindow} />
        </section>
      ) : (
        <section className="convo">
          <div className="empty">Wähle links eine Konversation.</div>
        </section>
      )}

      <aside className="panel">
        <div className="phead"><h3>Kunde</h3></div>
        {selected ? (
          <SocialMatch
            convId={selected.conv.id}
            customerName={selected.conv.customerName}
            customerEmail={selected.conv.customerEmail}
          />
        ) : (
          <div className="sec muted">Keine Konversation gewählt.</div>
        )}
      </aside>
    </>
  );
}
