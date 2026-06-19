import Link from "next/link";
import { and, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { initials, tagColor, timeAgo } from "@/lib/format";
import { Conversation } from "./conversation";
import { ShopifyPanel } from "./shopify-panel";
import { ShopSwitcher } from "./shop-switcher";

const OPEN: ("open" | "pending" | "escalated")[] = ["open", "pending", "escalated"];

const FOLDERS = [
  { key: "all-open", label: "Alle Offenen", ico: "📥" },
  { key: "mine", label: "Meine Offenen", ico: "👤" },
  { key: "unassigned", label: "Nicht zugewiesen", ico: "👥" },
  { key: "solved", label: "Gelöst", ico: "✓" },
  { key: "spam", label: "Spam", ico: "⊘" },
] as const;

function folderConds(folder: string, userId: string, shopId: string): SQL[] {
  const base: SQL[] = [eq(schema.threads.shopId, shopId)];
  switch (folder) {
    case "mine":
      return [...base, eq(schema.threads.assigneeId, userId), inArray(schema.threads.status, OPEN)];
    case "unassigned":
      return [...base, isNull(schema.threads.assigneeId), inArray(schema.threads.status, OPEN)];
    case "solved":
      return [...base, eq(schema.threads.status, "closed")];
    case "spam":
      return [...base, eq(schema.threads.status, "spam")];
    default:
      return [...base, inArray(schema.threads.status, OPEN)];
  }
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; ticket?: string }>;
}) {
  const { folder = "all-open", ticket } = await searchParams;
  const user = await requireUser();
  const shopIds = await accessibleShopIds(user);

  // Aktiver Shop = genau einer im Fokus. Ein geöffnetes Ticket "zieht" den aktiven
  // Shop auf seinen eigenen (damit z. B. Eskalations-Links shop-übergreifend funktionieren).
  let activeShopId = await getActiveShopId(shopIds);
  let selectedThread: typeof schema.threads.$inferSelect | null = null;
  if (ticket) {
    const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, ticket) });
    if (t && shopIds.includes(t.shopId)) {
      selectedThread = t;
      activeShopId = t.shopId;
    }
  }
  const hasShops = activeShopId !== null;

  // Shops für den Umschalter (nur die, die der Nutzer sehen darf)
  const shopList = hasShops
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(inArray(schema.shops.id, shopIds))
        .orderBy(schema.shops.name)
    : [];

  // Ordnerzähler (nur aktiver Shop)
  const counts: Record<string, number> = {};
  if (activeShopId) {
    const shopId = activeShopId;
    await Promise.all(
      FOLDERS.map(async (f) => {
        const [r] = await db
          .select({ c: count() })
          .from(schema.threads)
          .where(and(...folderConds(f.key, user.id, shopId)));
        counts[f.key] = r.c;
      }),
    );
  }

  // Ticket-Liste des aktiven Ordners (nur aktiver Shop)
  const tickets = activeShopId
    ? await db
        .select({
          id: schema.threads.id,
          number: schema.threads.number,
          subject: schema.threads.subject,
          customerEmail: schema.threads.customerEmail,
          customerName: schema.threads.customerName,
          tag: schema.threads.tag,
          status: schema.threads.status,
          lastMessageAt: schema.threads.lastMessageAt,
        })
        .from(schema.threads)
        .where(and(...folderConds(folder, user.id, activeShopId)))
        .orderBy(desc(schema.threads.lastMessageAt))
        .limit(100)
    : [];

  // Ausgewähltes Ticket laden (früh aufgelöster Thread)
  let selected: (typeof tickets[number] & { messages: Msg[] }) | null = null;
  let supportEmail = "support@";
  if (selectedThread) {
    {
      const t = selectedThread;
      const messages = await db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.threadId, t.id))
        .orderBy(schema.messages.createdAt);
      const mb = await db.query.shopMailboxes.findFirst({
        where: eq(schema.shopMailboxes.shopId, t.shopId),
      });
      supportEmail = mb?.fromEmail ?? "support@";
      selected = {
        id: t.id,
        number: t.number,
        subject: t.subject,
        customerEmail: t.customerEmail,
        customerName: t.customerName,
        tag: t.tag,
        status: t.status,
        lastMessageAt: t.lastMessageAt,
        messages: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          fromEmail: m.fromEmail,
          subject: m.subject,
          bodyText: m.bodyText,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }
  }

  const activeFolder = FOLDERS.find((f) => f.key === folder) ?? FOLDERS[0];

  return (
    <>
      {/* Spalte: Ordner */}
      <aside className="folders">
        {hasShops && activeShopId && (
          <div className="shopbar">
            <span className="shoplabel">Shop</span>
            <ShopSwitcher shops={shopList} activeId={activeShopId} />
          </div>
        )}
        <div className="head">
          <h1>Posteingang</h1>
          <button className="icon-btn ghost" aria-label="Suche">⌕</button>
          <button className="icon-btn primary" aria-label="Neu">+</button>
        </div>
        <div className="group-label">Tickets</div>
        {FOLDERS.map((f) => (
          <Link
            key={f.key}
            href={`/inbox?folder=${f.key}`}
            className={`folder ${f.key === folder ? "active" : ""}`}
          >
            <span className="ico">{f.ico}</span>
            <span>{f.label}</span>
            <span className="count">{counts[f.key] ?? 0}</span>
          </Link>
        ))}
      </aside>

      {/* Spalte: Ticket-Liste */}
      <section className="tickets">
        <div className="head">
          <span className="title">
            <span className="play">▶</span> {activeFolder.label}
          </span>
        </div>
        <div className="list">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/inbox?folder=${folder}&ticket=${t.id}`}
              className={`tcard ${t.id === ticket ? "active" : ""}`}
            >
              <div className="top">
                <span className="avatar">{initials(t.customerName, t.customerEmail)}</span>
                <span className="name">{t.customerName || t.customerEmail}</span>
                <span className="time">{timeAgo(new Date(t.lastMessageAt))}</span>
              </div>
              <div className="subj">{t.subject || "(kein Betreff)"}</div>
              <div className="bottom">
                {t.tag && <span className={`tag ${tagColor(t.tag)}`}>{t.tag}</span>}
                <span className="num">#{t.number}</span>
              </div>
            </Link>
          ))}
          {tickets.length === 0 && (
            <p className="muted" style={{ padding: 12 }}>
              {hasShops ? "Keine Tickets in diesem Ordner." : "Noch kein Shop angelegt (Admin)."}
            </p>
          )}
        </div>
      </section>

      {/* Spalte: Konversation */}
      {selected ? (
        <Conversation
          thread={{
            id: selected.id,
            subject: selected.subject,
            customerEmail: selected.customerEmail,
            customerName: selected.customerName,
            status: selected.status,
          }}
          messages={selected.messages}
          supportEmail={supportEmail}
        />
      ) : (
        <section className="convo">
          <div className="empty">Wähle links ein Ticket aus.</div>
        </section>
      )}

      {/* Spalte: Kundendetails / Shopify */}
      <aside className="panel">
        <div className="phead"><h3>Kundendetails</h3></div>
        {selected && activeShopId ? (
          <ShopifyPanel threadId={selected.id} shopId={activeShopId} />
        ) : (
          <div className="sec muted">Kein Ticket gewählt.</div>
        )}
      </aside>
    </>
  );
}

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  createdAt: string;
};
