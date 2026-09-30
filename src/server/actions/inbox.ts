"use server";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/server/db";
import { assertShopAccess, assignableUsers, requireUser, requireWrite } from "@/server/access";
import { ACTIVE_SHOP_COOKIE } from "@/server/active-shop";
import { sendOutboxMessage } from "@/server/send";
import { emailFromBody, isRelayAddress } from "@/lib/mailbox/extract";

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
  // Nur Personen zuweisen, die zu DIESEM Shop gehören.
  if (assigneeId && !(await assignableUsers(t.shopId)).some((u) => u.id === assigneeId)) {
    throw new Error("Diese Person gehört nicht zu diesem Shop.");
  }
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
export async function replyToThread(threadId: string, bodyText: string, filesForm?: FormData) {
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
  // Schattenbetrieb: das Team antwortet im Webmail — aus dem Tool wird nichts gesendet (kein Doppel-Versand).
  if (mailbox.shadowMode) {
    throw new Error("Schattenbetrieb aktiv: Bitte im Webmail antworten. Das Tool liest die Antwort automatisch mit und vergleicht sie mit dem KI-Entwurf.");
  }

  const lastInbound = await db.query.messages.findFirst({
    where: and(
      eq(schema.messages.threadId, threadId),
      eq(schema.messages.direction, "inbound"),
    ),
    orderBy: desc(schema.messages.createdAt),
  });

  // Empfänger bestimmen. Bei Kontaktformular-/Relay-Adressen (z. B. mailer@shopify.com) den echten
  // Kunden aus der ersten eingehenden Nachricht ziehen — sonst ginge die Antwort an das Relay.
  let recipient = t.customerEmail;
  if (isRelayAddress(recipient)) {
    const firstInbound = await db.query.messages.findFirst({
      where: and(eq(schema.messages.threadId, threadId), eq(schema.messages.direction, "inbound")),
      orderBy: schema.messages.createdAt,
    });
    const real = emailFromBody(firstInbound?.bodyText ?? null, mailbox.fromEmail);
    if (real) recipient = real;
  }

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

  let createdMessageId: string | null = null;
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(schema.messages)
      .values({
        threadId,
        direction: "outbound",
        fromEmail: mailbox.fromEmail,
        toEmail: recipient,
        subject,
        bodyText,
        messageId: newMsgId,
        inReplyTo: lastInbound?.messageId ?? null,
        aiOutcome,
        aiDraft: t.lastAiDraft ?? null,
        aiDecision: t.lastAiDraft ? t.aiDecision : null,
        sentBy: user.id,
      })
      .returning({ id: schema.messages.id });
    createdMessageId = msg.id;
    await tx.insert(schema.outbox).values({ messageId: msg.id });
    await tx
      .update(schema.threads)
      .set({
        status: "pending",
        lastMessageAt: new Date(),
        // Erste Antwortzeit festhalten (nur beim ersten Mal); Entwurf-Puffer leeren.
        firstResponseAt: t.firstResponseAt ?? new Date(),
        lastAiDraft: null,
        aiDecision: null,
        aiReason: null,
        aiDraftAt: null,
      })
      .where(eq(schema.threads.id, threadId));
  });

  // Anhänge VOR dem Senden speichern, damit sie in der Mail mitgehen (max. 5 × 8 MB).
  if (createdMessageId && filesForm) {
    const files = filesForm.getAll("files").filter((f): f is File => f instanceof File).slice(0, 5);
    for (const f of files) {
      if (f.size <= 0 || f.size > 8 * 1024 * 1024) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      await db.insert(schema.messageAttachment).values({
        messageId: createdMessageId,
        filename: f.name || "anhang",
        contentType: f.type || "application/octet-stream",
        sizeBytes: buf.length,
        content: buf,
      });
    }
  }

  // SOFORT senden (nicht auf den Worker warten). Klappt es, sieht der Mitarbeiter direkt „gesendet".
  // Schlägt SMTP fehl, bleibt die Zeile in der Warteschlange und der Worker versucht es erneut.
  if (createdMessageId) {
    try {
      await sendOutboxMessage(createdMessageId);
    } catch {
      /* egal — Worker übernimmt den Retry */
    }
  }

  revalidatePath(`/threads/${threadId}`);
  revalidatePath("/inbox");
}

/** Hängende/fehlgeschlagene Antwort sofort erneut senden (nicht nur neu einreihen). */
export async function retrySend(messageId: string) {
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg) throw new Error("Nachricht nicht gefunden");
  const t = await loadThread(msg.threadId);
  await requireWrite(t.shopId, "support");
  await db
    .update(schema.outbox)
    .set({ status: "pending", attempts: 0, lastError: null })
    .where(eq(schema.outbox.messageId, messageId));
  // Direkt zustellen, damit der Mitarbeiter sofort das Ergebnis sieht.
  try {
    await sendOutboxMessage(messageId);
  } catch {
    /* egal — Worker übernimmt den Retry */
  }
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

/** Kollisionsschutz: „ich habe dieses Ticket offen (und tippe ggf.)“ melden + wer sonst gerade dran ist. */
export async function touchPresence(threadId: string, typing: boolean): Promise<{ name: string; typing: boolean }[]> {
  const user = await requireUser();
  const t = await loadThread(threadId);
  await assertShopAccess(user, t.shopId);
  await db
    .insert(schema.ticketPresence)
    .values({ threadId, userId: user.id, typing, seenAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.ticketPresence.threadId, schema.ticketPresence.userId],
      set: { typing, seenAt: new Date() },
    });
  const others = await db
    .select({ name: schema.users.name, email: schema.users.email, typing: schema.ticketPresence.typing })
    .from(schema.ticketPresence)
    .innerJoin(schema.users, eq(schema.users.id, schema.ticketPresence.userId))
    .where(
      and(
        eq(schema.ticketPresence.threadId, threadId),
        ne(schema.ticketPresence.userId, user.id),
        gt(schema.ticketPresence.seenAt, new Date(Date.now() - 45_000)),
      ),
    );
  return others.map((o) => ({ name: o.name || o.email, typing: o.typing }));
}
