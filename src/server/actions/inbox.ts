"use server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser, requireWrite } from "@/server/access";
import { ACTIVE_SHOP_COOKIE } from "@/server/active-shop";

/** Aktiven Shop wechseln (vom Shop-Umschalter aufgerufen). */
export async function setActiveShop(shopId: string, redirectTo: string = "/inbox") {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const store = await cookies();
  store.set(ACTIVE_SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(redirectTo);
}

/** Aktiven Shop global setzen (Sidebar-Umschalter) — ohne Redirect; Client macht router.refresh(). */
export async function selectActiveShop(shopId: string) {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const store = await cookies();
  store.set(ACTIVE_SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/" });
}

async function loadThread(threadId: string) {
  const t = await db.query.threads.findFirst({
    where: eq(schema.threads.id, threadId),
  });
  if (!t) throw new Error("Thread nicht gefunden");
  return t;
}

export async function assignThread(threadId: string, assigneeId: string | null) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({ assigneeId })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

export async function setThreadTag(threadId: string, tag: string | null) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({ tag: tag && tag.trim() ? tag.trim() : null })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

/** Interne Notiz am Ticket (nicht an den Kunden, wird nie versendet). */
export async function addNote(threadId: string, bodyText: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  if (!bodyText.trim()) throw new Error("Leere Notiz");
  await db.insert(schema.messages).values({
    threadId,
    direction: "outbound",
    internal: true,
    fromEmail: user.email,
    bodyText,
    sentBy: user.id,
  });
  revalidatePath("/inbox");
}

export async function setThreadStatus(threadId: string, status: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({
      status: status as "open" | "pending" | "escalated" | "closed",
      // Lösungszeit-Tracking: beim Schließen Zeitstempel setzen, beim Wieder-Öffnen löschen.
      closedAt: status === "closed" ? new Date() : null,
    })
    .where(eq(schema.threads.id, threadId));
  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

export async function escalateThread(threadId: string, reason: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db.transaction(async (tx) => {
    await tx
      .update(schema.threads)
      .set({ status: "escalated" })
      .where(eq(schema.threads.id, threadId));
    await tx.insert(schema.escalations).values({
      threadId,
      raisedBy: user.id,
      reason: reason || null,
    });
  });
  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
  revalidatePath("/admin");
}

/** Draft-First: vom Menschen freigegebene Antwort -> Outbound-Message + Outbox-Job. */
export async function replyToThread(threadId: string, bodyText: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  if (!bodyText.trim()) throw new Error("Leere Antwort");

  // Antwort geht über das Postfach des Tickets raus (Fallback: erstes Postfach des Shops).
  const mailbox =
    (t.mailboxId
      ? await db.query.shopMailboxes.findFirst({
          where: eq(schema.shopMailboxes.id, t.mailboxId),
        })
      : null) ??
    (await db.query.shopMailboxes.findFirst({
      where: eq(schema.shopMailboxes.shopId, t.shopId),
    }));
  if (!mailbox) throw new Error("Shop hat keine Postfach-Konfiguration");

  const lastInbound = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.threadId, threadId),
      eq(schema.messages.direction, "inbound"),
    ),
    orderBy: desc(schema.messages.createdAt),
  });

  const subject = (t.subject ?? "").toLowerCase().startsWith("re:")
    ? t.subject
    : `Re: ${t.subject ?? ""}`.trim();
  const newMsgId = `<${randomUUID().replace(/-/g, "")}@support-brain>`;

  // KI-Entwurf-Nutzung messen: 1:1 übernommen, bearbeitet oder ganz ohne Entwurf.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const aiOutcome = t.lastAiDraft
    ? norm(bodyText) === norm(t.lastAiDraft)
      ? "verbatim"
      : "edited"
    : "manual";

  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(schema.messages)
      .values({
        threadId,
        direction: "outbound",
        fromEmail: mailbox.fromEmail,
        toEmail: t.customerEmail,
        subject,
        bodyText,
        messageId: newMsgId,
        inReplyTo: lastInbound?.messageId ?? null,
        aiOutcome,
        sentBy: user.id,
      })
      .returning({ id: schema.messages.id });
    await tx.insert(schema.outbox).values({ messageId: msg.id });
    await tx
      .update(schema.threads)
      .set({
        status: "pending",
        lastMessageAt: new Date(),
        // Erste Antwortzeit festhalten (nur beim ersten Mal); Entwurf-Puffer leeren.
        firstResponseAt: t.firstResponseAt ?? new Date(),
        lastAiDraft: null,
      })
      .where(eq(schema.threads.id, threadId));
  });

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

/** Fehlgeschlagenen Versand erneut in die Warteschlange stellen (Worker sendet dann neu). */
export async function retrySend(messageId: string) {
  const user = await requireUser();
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg) throw new Error("Nachricht nicht gefunden");
  const t = await loadThread(msg.threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.outbox)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(eq(schema.outbox.messageId, messageId));
  revalidatePath("/inbox");
}

/** Ticket in den Papierkorb legen. Beim nächsten Worker-Lauf wandert die Mail in den Trash-Ordner. */
export async function deleteThread(threadId: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db.update(schema.threads).set({ deletedAt: new Date() }).where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}

/** Ticket aus dem Papierkorb wiederherstellen (zurueck in den Posteingang). */
export async function restoreThread(threadId: string) {
  const t = await loadThread(threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.threads)
    .set({ deletedAt: null, status: "open" })
    .where(eq(schema.threads.id, threadId));
  revalidatePath("/inbox");
}
