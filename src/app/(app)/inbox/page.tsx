import Link from "next/link";
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, assignableUsers, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { initials, tagColor, timeAgo } from "@/lib/format";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { Conversation } from "./conversation";
import { listCannedReplies } from "@/server/canned";
import { ShopifyPanel } from "./shopify-panel";
import { SyncButton } from "./sync-button";

const OPEN: ("open" | "pending" | "escalated")[] = ["open", "pending", "escalated"];

// Ab wann eine noch nicht gesendete Antwort als "hängt fest" gilt (Kontrolle gegen stille Ausfälle).
const STUCK_SEND_MS = Number(process.env.STUCK_SEND_MINUTES ?? 10) * 60_000;

const FOLDERS = [
  { key: "all-open", label: "Alle Offenen", ico: "📥" },
  { key: "mine", label: "Meine Offenen", ico: "👤" },
  { key: "unassigned", label: "Nicht zugewiesen", ico: "👥" },
  { key: "solved", label: "Gelöst", ico: "✓" },
  { key: "spam", label: "Spam", ico: "⊘" },
  { key: "trash", label: "Papierkorb", ico: "🗑" },
] as const;

function folderConds(folder: string, userId: string, shopId: string): SQL[] {
  const base: SQL[] = [eq(schema.threads.shopId, shopId)];
  // Papierkorb zeigt nur gelöschte; alle anderen Ordner blenden gelöschte aus.
  if (folder === "trash") return [...base, isNotNull(schema.threads.deletedAt)];
  const live: SQL[] = [...base, isNull(schema.threads.deletedAt)];
  switch (folder) {
    case "mine":
      return [...live, eq(schema.threads.assigneeId, userId), inArray(schema.threads.status, OPEN)];
    case "unassigned":
      return [...live, isNull(schema.threads.assigneeId), inArray(schema.threads.status, OPEN)];
    case "solved":
      return [...live, eq(schema.threads.status, "closed")];
    case "spam":
      return [...live, eq(schema.threads.status, "spam")];
    default:
      return [...live, inArray(schema.threads.status, OPEN)];
  }
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; ticket?: string; q?: string }>;
}) {
  const { folder = "all-open", ticket, q } = await searchParams;
  const search = q?.trim() ?? "";
  const user = await requireUser();
  const accessible = await accessibleShopIds(user);

  // Umschalter zeigt nur AKTIVE Shops, auf die der Nutzer Zugriff hat.
  const shopList = accessible.length
    ? await db
        .select({ id: schema.shops.id, name: schema.shops.name })
        .from(schema.shops)
        .where(and(inArray(schema.shops.id, accessible), eq(schema.shops.active, true)))
        .orderBy(schema.shops.name)
    : [];
  const activeIds = shopList.map((s) => s.id);

  // Aktiver Shop = genau einer im Fokus. Ein geöffnetes Ticket "zieht" den aktiven
  // Shop auf seinen eigenen (damit z. B. Eskalations-Links funktionieren).
  let activeShopId = await getActiveShopId(activeIds);
  let selectedThread: typeof schema.threads.$inferSelect | null = null;
  if (ticket) {
    const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, ticket) });
    if (t && activeIds.includes(t.shopId)) {
      selectedThread = t;
      activeShopId = t.shopId;
    }
  }
  const hasShops = activeShopId !== null;

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

  // Kontrolle: Antworten, die seit über der Schwelle in der Warteschlange hängen (nicht zugestellt).
  let stuckSends: { number: number; id: string }[] = [];
  if (activeShopId) {
    stuckSends = await db
      .selectDistinct({ number: schema.threads.number, id: schema.threads.id })
      .from(schema.outbox)
      .innerJoin(schema.messages, eq(schema.messages.id, schema.outbox.messageId))
      .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
      .where(
        and(
          eq(schema.threads.shopId, activeShopId),
          eq(schema.outbox.status, "pending"),
          lt(schema.outbox.createdAt, new Date(Date.now() - STUCK_SEND_MS)),
        ),
      )
      .orderBy(desc(schema.threads.number))
      .limit(50);
  }

  // Ticket-Liste: bei Suche shop-weit über alle Status, sonst aktiver Ordner.
  function listWhere(shopId: string): SQL {
    if (search) {
      const like = `%${search}%`;
      const parts: SQL[] = [
        ilike(schema.threads.subject, like),
        ilike(schema.threads.customerEmail, like),
        ilike(schema.threads.customerName, like),
      ];
      if (/^\d+$/.test(search)) parts.push(eq(schema.threads.number, Number(search)));
      return and(eq(schema.threads.shopId, shopId), isNull(schema.threads.deletedAt), or(...parts)!)!;
    }
    return and(...folderConds(folder, user.id, shopId))!;
  }

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
          assigneeId: schema.threads.assigneeId,
          lastMessageAt: schema.threads.lastMessageAt,
        })
        .from(schema.threads)
        .where(listWhere(activeShopId))
        .orderBy(desc(schema.threads.lastMessageAt))
        .limit(100)
    : [];

  // Namen der zugewiesenen Agents für die Badges.
  const assigneeIds = [...new Set(tickets.map((t) => t.assigneeId).filter(Boolean))] as string[];
  const assigneeMap = new Map<string, string>();
  if (assigneeIds.length) {
    const us = await db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.id, assigneeIds));
    for (const u of us) assigneeMap.set(u.id, u.name || u.email);
  }

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
      // Sende-Status (Outbox) je ausgehender Nachricht — für „gesendet/Warteschlange/fehlgeschlagen".
      const outboxRows = messages.length
        ? await db
            .select({ messageId: schema.outbox.messageId, status: schema.outbox.status, lastError: schema.outbox.lastError, createdAt: schema.outbox.createdAt })
            .from(schema.outbox)
            .where(inArray(schema.outbox.messageId, messages.map((m) => m.id)))
        : [];
      const obMap = new Map(outboxRows.map((o) => [o.messageId, o]));
      // Anhänge (Fotos etc.) je Nachricht — nur Metadaten, Inhalt kommt über /api/attachments/[id].
      const attRows = messages.length
        ? await db
            .select({
              id: schema.messageAttachment.id,
              messageId: schema.messageAttachment.messageId,
              filename: schema.messageAttachment.filename,
              contentType: schema.messageAttachment.contentType,
              sizeBytes: schema.messageAttachment.sizeBytes,
            })
            .from(schema.messageAttachment)
            .where(inArray(schema.messageAttachment.messageId, messages.map((m) => m.id)))
        : [];
      const attMap = new Map<string, typeof attRows>();
      for (const a of attRows) {
        const arr = attMap.get(a.messageId) ?? [];
        arr.push(a);
        attMap.set(a.messageId, arr);
      }
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
        assigneeId: t.assigneeId,
        lastMessageAt: t.lastMessageAt,
        messages: messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          internal: m.internal,
          fromEmail: m.fromEmail,
          subject: m.subject,
          // HTML-only-Mails lesbar machen (alte Bestände haben teils keinen Klartext).
          bodyText: bestBodyText(m.bodyText, m.bodyHtml),
          createdAt: m.createdAt.toISOString(),
          sendStatus: obMap.get(m.id)?.status ?? null,
          sendError: obMap.get(m.id)?.lastError ?? null,
          // "hängt fest": noch in Warteschlange, aber älter als die Schwelle -> nicht zugestellt.
          sendStuck:
            obMap.get(m.id)?.status === "pending" &&
            obMap.get(m.id)!.createdAt < new Date(Date.now() - STUCK_SEND_MS),
          attachments: (attMap.get(m.id) ?? []).map((a) => ({
            id: a.id,
            filename: a.filename,
            contentType: a.contentType,
            sizeBytes: a.sizeBytes,
          })),
        })),
      };
    }
  }

  // „Senden & nächstes": das Ticket NACH dem aktuellen in der Liste (gleicher Ordner).
  const curIdx = ticket ? tickets.findIndex((t) => t.id === ticket) : -1;
  const nextTicket = curIdx >= 0 ? tickets[curIdx + 1] ?? null : null;
  const nextHref = nextTicket ? `/inbox?folder=${folder}&ticket=${nextTicket.id}` : null;

  const assignees = selected && activeShopId ? await assignableUsers(activeShopId) : [];
  const cannedReplies = selected && activeShopId ? await listCannedReplies(activeShopId) : [];

  // Verknüpfter Dispute-Fall (Badge in der Konversation).
  let disputeId: string | null = null;
  if (selectedThread) {
    const dc = await db.query.disputeCase.findFirst({
      where: eq(schema.disputeCase.threadId, selectedThread.id),
    });
    disputeId = dc?.id ?? null;
  }

  const activeFolder = FOLDERS.find((f) => f.key === folder) ?? FOLDERS[0];

  return (
    <div className="inbox-root" data-selected={selected ? "1" : "0"}>
      {/* Spalte: Ordner */}
      <aside className="folders">
        {hasShops && activeShopId && (
          <div className="shopbar">
            <span className="shoplabel">Shop</span>
            <span className="shopcur">{shopList.find((s) => s.id === activeShopId)?.name ?? "—"}</span>
          </div>
        )}
        <div className="head">
          <h1>Posteingang</h1>
          <SyncButton />
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
        {stuckSends.length > 0 && (
          <div className="stuckbar" title="Diese Antworten wurden noch nicht zugestellt">
            ⚠ {stuckSends.length} Antwort(en) hängen fest (nicht zugestellt):{" "}
            {stuckSends.slice(0, 8).map((s, i) => (
              <span key={s.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/inbox?folder=${folder}&ticket=${s.id}`}>#{s.number}</Link>
              </span>
            ))}
            {stuckSends.length > 8 ? " …" : ""} — Postfach/Worker prüfen.
          </div>
        )}
        <div className="head">
          <span className="title">
            <span className="play">▶</span> {search ? `Suche: „${search}"` : activeFolder.label}
          </span>
        </div>
        {hasShops && (
          <form className="searchbar" action="/inbox">
            <input type="hidden" name="folder" value={folder} />
            <input name="q" defaultValue={search} placeholder="Suchen… (Name, E-Mail, Betreff, #Nr.)" />
            {search && <Link href={`/inbox?folder=${folder}`} className="clear" title="Suche löschen">✕</Link>}
          </form>
        )}
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
                {t.assigneeId && (
                  <span className="assignee" title={`Zugewiesen: ${assigneeMap.get(t.assigneeId) ?? "?"}`}>
                    {initials(assigneeMap.get(t.assigneeId) ?? null, "?")}
                  </span>
                )}
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
          key={selected.id}
          thread={{
            id: selected.id,
            subject: selected.subject,
            customerEmail: selected.customerEmail,
            customerName: selected.customerName,
            status: selected.status,
            assigneeId: selected.assigneeId,
            tag: selected.tag,
            deleted: selectedThread!.deletedAt != null,
          }}
          messages={selected.messages}
          supportEmail={supportEmail}
          assignees={assignees}
          disputeId={disputeId}
          cannedReplies={cannedReplies}
          nextHref={nextHref}
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
    </div>
  );
}

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  internal: boolean;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  createdAt: string;
  sendStatus: "pending" | "sent" | "failed" | null;
  sendError: string | null;
  sendStuck: boolean;
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};
