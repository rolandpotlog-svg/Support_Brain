"use server";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";
import { ACTIVE_SHOP_COOKIE } from "@/server/active-shop";

/** Aktiven Shop wechseln (vom Shop-Umschalter im Posteingang aufgerufen). */
export async function setActiveShop(shopId: string) {
  const user = await requireUser();
  await assertShopAccess(user, shopId);
  const store = await cookies();
  store.set(ACTIVE_SHOP_COOKIE, shopId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/inbox");
}

async function loadThread(threadId: string) {
  const t = await db.query.threads.findFirst({
    where: eq(schema.threads.id, threadId),
  });
  if (!t) throw new Error("Thread nicht gefunden");
  return t;
}

export async function setThreadStatus(threadId: string, status: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await assertShopAccess(user, t.shopId);
  await db
    .update(schema.threads)
    .set({ status: status as "open" | "pending" | "escalated" | "closed" })
    .where(eq(schema.threads.id, threadId));
  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

export async function escalateThread(threadId: string, reason: string) {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await assertShopAccess(user, t.shopId);
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
  await assertShopAccess(user, t.shopId);
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
        sentBy: user.id,
      })
      .returning({ id: schema.messages.id });
    await tx.insert(schema.outbox).values({ messageId: msg.id });
    await tx
      .update(schema.threads)
      .set({ status: "pending", lastMessageAt: new Date() })
      .where(eq(schema.threads.id, threadId));
  });

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}
