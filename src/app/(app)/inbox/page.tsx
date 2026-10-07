import Link from "next/link";
import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accessibleShopIds, assignableUsers, requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { initials, tagColor, timeAgo } from "@/lib/format";
import { intentShort } from "@/lib/support/intents";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { Conversation } from "./conversation";
import { SwitchShopButton } from "./switch-shop-button";
import { listCannedReplies } from "@/server/canned";
import { ShopifyPanel } from "./shopify-panel";
import { SyncButton } from "./sync-button";

// „Offen“ = wir sind dran. Beantwortete Tickets (pending) liegen in „Beantwortet“, kommen automatisch
// zurück, sobald der Kunde antwortet, und werden nach 5 Tagen ohne Antwort automatisch „Gelöst“.
const OPEN: ("open" | "escalated")[] = ["open", "escalated"];

// Warteschlangen nach Anliegen (Filter-Chips über der Liste).
const QUEUES = [
  { key: "", label: "Alle", intents: null },
  { key: "lieferung", label: "Lieferung", intents: ["wismo", "nachfrage", "nicht_erhalten", "adresse"] },
  { key: "problem", label: "Defekt / Beschädigt", intents: ["beschaedigt", "defekt", "gravur_fehler", "falsch_fehlt"] },
  { key: "retoure", label: "Retoure / Storno", intents: ["retoure", "storno", "nicht_wie_erwartet"] },
  { key: "sonst", label: "Sonstiges", intents: ["gravur_angaben", "zahlung", "produktfrage", "lob", "sonstiges"] },
] as const;

// Ab wann eine noch nicht gesendete Antwort als "hängt fest" gilt (Kontrolle gegen stille Ausfälle).
const STUCK_SEND_MS = Number(process.env.STUCK_SEND_MINUTES ?? 10) * 60_000;

const FOLDERS = [
  { key: "all-open", label: "Alle Offenen", ico: "📥" },
  { key: "mine", label: "Meine Offenen", ico: "👤" },
  { key: "unassigned", label: "Nicht zugewiesen", ico: "👥" },
  { key: "waiting", label: "Beantwortet", ico: "↩" },
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
    case "waiting":
      return [...live, eq(schema.threads.status, "pending")];
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
  searchParams: Promise<{ folder?: string; ticket?: string; q?: string; a?: string }>;
}) {
  const { folder = "all-open", ticket, q, a = "" } = await searchParams;
  const queue = QUEUES.find((x) => x.key === a) ?? QUEUES[0];
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
  const cookieShopId = activeShopId; // der oben in der Shop-Leiste gewählte Shop
  let selectedThread: typeof schema.threads.$inferSelect | null = null;
  if (ticket) {
    const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, ticket) });
    if (t && activeIds.includes(t.shopId)) {
      selectedThread = t;
      activeShopId = t.shopId;
    }
  }
  const hasShops = activeShopId !== null;
  // Ticket aus einem ANDEREN Shop geöffnet (z. B. über einen Link) -> deutlich darauf hinweisen.
  const foreignTicketShop =
    selectedThread && cookieShopId && selectedThread.shopId !== cookieShopId
      ? shopList.find((s) => s.id === selectedThread!.shopId) ?? null
      : null;

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
      const digits = search.replace(/^#/, "");
      const parts: SQL[] = [
        ilike(schema.threads.subject, like),
        ilike(schema.threads.customerEmail, like),
        ilike(schema.threads.customerName, like),
        // zugeordnete / manuell gemerkte Bestellnummer (mit oder ohne #)
        ilike(schema.threads.orderName, `%${digits}%`),
        ilike(schema.threads.manualOrderName, `%${digits}%`),
        // Text der Mails (z. B. Bestellnummer oder Name nur in der Nachricht)
        sql`exists (select 1 from messages m where m.thread_id = ${schema.threads.id} and m.body_text ilike ${like})`,
      ];
      if (/^#?\d+$/.test(search) && digits.length <= 7) parts.push(eq(schema.threads.number, Number(digits)));
      return and(eq(schema.threads.shopId, shopId), isNull(schema.threads.deletedAt), or(...parts)!)!;
    }
    const conds = folderConds(folder, user.id, shopId);
    if (queue?.intents) conds.push(inArray(schema.threads.aiIntent, [...queue.intents]));
    return and(...conds)!;
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
          aiIntent: schema.threads.aiIntent,
          aiIssue: schema.threads.aiIssue,
          aiSummary: schema.threads.aiSummary,
          aiSentiment: schema.threads.aiSentiment,
          aiDecision: schema.threads.aiDecision,
          hasDraft: sql<boolean>`${schema.threads.lastAiDraft} is not null`,
          orderName: schema.threads.orderName,
        })
        .from(schema.threads)
        .where(listWhere(activeShopId))
        .orderBy(desc(schema.threads.lastMessageAt))
        .limit(100)
    : [];

  // Anzahl je Warteschlange (im aktuellen Ordner) für die Filter-Chips.
  const queueCounts = new Map<string, number>();
  if (activeShopId && !search) {
    const rows = await db
      .select({ intent: schema.threads.aiIntent, n: count() })
      .from(schema.threads)
      .where(and(...folderConds(folder, user.id, activeShopId)))
      .groupBy(schema.threads.aiIntent);
    let total = 0;
    for (const r of rows) {
      total += r.n;
      const q = QUEUES.find((x) => x.intents && (x.intents as readonly string[]).includes(r.intent ?? ""));
      const key = q?.key ?? "sonst";
      queueCounts.set(key, (queueCounts.get(key) ?? 0) + r.n);
    }
    queueCounts.set("", total);
  }
  const qHref = (key: string) => `/inbox?folder=${folder}${key ? `&a=${key}` : ""}`;

  // Wer arbeitet gerade an welchem Ticket? (Kollisionsschutz schon in der Liste)
  const busy = new Map<string, string[]>();
  if (tickets.length) {
    const pres = await db
      .select({ threadId: schema.ticketPresence.threadId, name: schema.users.name, email: schema.users.email, userId: schema.ticketPresence.userId })
      .from(schema.ticketPresence)
      .innerJoin(schema.users, eq(schema.users.id, schema.ticketPresence.userId))
      .where(and(inArray(schema.ticketPresence.threadId, tickets.map((t) => t.id)), sql`${schema.ticketPresence.seenAt} > now() - interval '45 seconds'`));
    for (const p of pres) {
      if (p.userId === user.id) continue;
      busy.set(p.threadId, [...(busy.get(p.threadId) ?? []), (p.name || p.email).split(" ")[0]]);
    }
  }

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
            .select({ messageId: schema.outbox.messageId, status: schema.outbox.status, lastError: schema.outbox.lastError, createdAt: schema.outbox.createdAt, sendAfter: schema.outbox.sendAfter })
            .from(schema.outbox)
            .where(inArray(schema.outbox.messageId, messages.map((m) => m.id)))
        : [];
      const obMap = new Map(outboxRows.map((o) => [o.messageId, o]));
      // Wer hat geantwortet? (Name des Mitarbeiters je gesendeter Antwort)
      const senderIds = [...new Set(messages.map((m) => m.sentBy).filter(Boolean))] as string[];
      const senderMap = new Map(
        senderIds.length
          ? (await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, senderIds))).map((u) => [u.id, u.name || u.email])
          : [],
      );
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
        aiIntent: t.aiIntent,
        aiIssue: t.aiIssue,
        aiSummary: t.aiSummary,
        aiSentiment: t.aiSentiment,
        aiDecision: t.aiDecision,
        hasDraft: t.lastAiDraft != null,
        orderName: t.orderName,
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
          sentByName: m.sentBy ? senderMap.get(m.sentBy) ?? null : null,
          sendError: obMap.get(m.id)?.lastError ?? null,
          // "hängt fest": noch in Warteschlange, aber älter als die Schwelle -> nicht zugestellt.
          sendStuck:
            obMap.get(m.id)?.status === "pending" &&
            !(obMap.get(m.id)!.sendAfter && obMap.get(m.id)!.sendAfter! > new Date()) &&
            obMap.get(m.id)!.createdAt < new Date(Date.now() - STUCK_SEND_MS),
          // Automatische Antwort im Sicherheitsfenster: wann sie rausgeht
          autoAt: m.aiOutcome === "auto" && obMap.get(m.id)?.status === "pending" ? (obMap.get(m.id)!.sendAfter?.toISOString() ?? new Date().toISOString()) : null,
          isAuto: m.aiOutcome === "auto",
          viaWebmail: m.aiOutcome === "webmail",
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
    <>
    {foreignTicketShop && (
      <div className="alertbar warn" style={{ position: "fixed", top: 44, right: 16, zIndex: 50, display: "flex", gap: 10, alignItems: "center", maxWidth: 520 }}>
        <span>
          ⚠️ Dieses Ticket gehört zu <b>{foreignTicketShop.name}</b>, aktiv ist aber{" "}
          <b>{shopList.find((s) => s.id === cookieShopId)?.name}</b>.
        </span>
        <SwitchShopButton shopId={foreignTicketShop.id} name={foreignTicketShop.name} />
      </div>
    )}
    <div className="inbox-root" data-selected={selected ? "1" : "0"}>
      {/* Spalte: Ordner */}
      <aside className="folders">
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
            <input name="q" defaultValue={search} placeholder="Suchen… (Name, E-Mail, Bestellnr., Text, #Ticket)" />
            {search && <Link href={`/inbox?folder=${folder}`} className="clear" title="Suche löschen">✕</Link>}
          </form>
        )}
        {/* Kompakt-Modus (MacBook): Ordner als Chips, weil die Ordnerspalte ausgeblendet ist. */}
        {hasShops && (
          <div className="folderchips">
            {FOLDERS.map((f) => (
              <Link key={f.key} href={`/inbox?folder=${f.key}`} className={`qchip ${folder === f.key ? "on" : ""}`}>
                {f.label} <span>{counts[f.key] ?? 0}</span>
              </Link>
            ))}
          </div>
        )}
        {hasShops && !search && (
          <div className="queues">
            {QUEUES.map((qq) => (
              <Link key={qq.key} href={qHref(qq.key)} className={`qchip ${queue.key === qq.key ? "on" : ""}`}>
                {qq.label} <span>{queueCounts.get(qq.key) ?? 0}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="list">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/inbox?folder=${folder}${queue.key ? `&a=${queue.key}` : ""}&ticket=${t.id}`}
              className={`tcard ${t.id === ticket ? "active" : ""}`}
            >
              <div className="top">
                <span className="avatar">{initials(t.customerName, t.customerEmail)}</span>
                <span className="name">{t.customerName || t.customerEmail}</span>
                <span className="time">{timeAgo(new Date(t.lastMessageAt))}</span>
              </div>
              {/* KI-Zusammenfassung statt Betreff: man sieht sofort, was der Kunde will. */}
              <div className="subj">{t.aiSummary || t.subject || "(kein Betreff)"}</div>
              <div className="bottom">
                {t.aiIntent ? (
                  <span className={`ichip i-${t.aiIntent}`}>{intentShort(t.aiIntent)}{t.aiIssue ? ` · ${t.aiIssue}` : ""}</span>
                ) : (
                  t.tag && <span className={`tag ${tagColor(t.tag)}`}>{t.tag}</span>
                )}
                {t.aiSentiment === "negativ" && <span className="dot-neg" title="Kunde verärgert" />}
                {busy.get(t.id) && <span className="busychip" title="Arbeitet gerade an diesem Ticket">👀 {busy.get(t.id)!.join(", ")}</span>}
                {t.hasDraft && (
                  <span className={`draftchip ${t.aiDecision === "mensch" ? "human" : ""}`} title={t.aiDecision === "mensch" ? "Entwurf da — KI empfiehlt: Mensch entscheidet" : "KI-Entwurf bereit"}>
                    {t.aiDecision === "mensch" ? "Prüfen" : "Entwurf"}
                  </span>
                )}
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
            // Auto-Entwurf des Workers vorbefüllen (nur wenn er zur aktuellen Kundenmail passt).
            aiDraft: selectedThread!.lastAiDraft,
            // Entwurf passt zur aktuellen Kundenmail? (sonst startet der Posteingang beim Öffnen einen neuen)
            aiDraftFresh: Boolean(
              selectedThread!.lastAiDraft && selectedThread!.aiDraftAt && selectedThread!.aiDraftAt >= selectedThread!.lastMessageAt,
            ),
            aiCheck: selectedThread!.aiCheck ?? null,
            aiDecision: selectedThread!.aiDecision,
            aiReason: selectedThread!.aiReason,
            aiIntent: selectedThread!.aiIntent,
            aiIssue: selectedThread!.aiIssue,
            aiItem: selectedThread!.aiItem,
            aiSummary: selectedThread!.aiSummary,
            orderName: selectedThread!.orderName,
            orderConfidence: selectedThread!.orderConfidence,
            orderChecks: (selectedThread!.orderChecks as { label: string; status: string; detail?: string }[] | null) ?? [],
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
    </>
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
  sentByName: string | null;
  viaWebmail?: boolean;
  sendError: string | null;
  sendStuck: boolean;
  autoAt: string | null;
  isAuto: boolean;
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};
