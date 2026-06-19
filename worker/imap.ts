// IMAP-Ingest (rein): neue Mails je Shop abholen -> Threads/Messages.
// Inkrementell über das UID-Wasserzeichen, Dedup über die Message-ID.
// Läuft unabhängig vom Kill-Switch (der betrifft nur die KI, nicht den Abruf).
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { decrypt } from "../src/lib/mailbox/crypto";

const RE_PREFIX = /^\s*(re|aw|fwd|wg)\s*:\s*/i;

function normalizeSubject(subject: string | null | undefined): string {
  let s = subject ?? "";
  while (RE_PREFIX.test(s)) s = s.replace(RE_PREFIX, "");
  return s.trim().toLowerCase();
}

async function resolveThreadId(
  shopId: string,
  customerEmail: string,
  subject: string | null,
  refIds: string[],
): Promise<string> {
  if (refIds.length) {
    const m = await db.query.messages.findFirst({
      where: inArray(schema.messages.messageId, refIds),
    });
    if (m) return m.threadId;
  }

  const norm = normalizeSubject(subject);
  if (norm) {
    const candidates = await db
      .select({ id: schema.threads.id, subject: schema.threads.subject })
      .from(schema.threads)
      .where(
        and(
          eq(schema.threads.shopId, shopId),
          sql`lower(${schema.threads.customerEmail}) = lower(${customerEmail})`,
          sql`${schema.threads.status} <> 'closed'`,
        ),
      )
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(50);
    for (const c of candidates) {
      if (normalizeSubject(c.subject) === norm) return c.id;
    }
  }

  const [created] = await db
    .insert(schema.threads)
    .values({ shopId, subject: subject ?? null, customerEmail })
    .returning({ id: schema.threads.id });
  return created.id;
}

async function ingestShop(shop: typeof schema.shops.$inferSelect): Promise<number> {
  const mb = await db.query.shopMailboxes.findFirst({
    where: eq(schema.shopMailboxes.shopId, shop.id),
  });
  if (!mb) return 0;

  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: true,
    auth: { user: mb.imapUser, pass: decrypt(mb.imapPasswordEnc) },
    logger: false,
  });
  await client.connect();

  let processed = 0;
  let maxUid = mb.lastSeenUid ?? 0;
  const lock = await client.getMailboxLock("INBOX");
  try {
    const range = `${(mb.lastSeenUid ?? 0) + 1}:*`;
    for await (const msg of client.fetch(range, { uid: true, source: true }, { uid: true })) {
      const uid = msg.uid;
      if (uid <= (mb.lastSeenUid ?? 0)) {
        // IMAP liefert bei :* manchmal die letzte UID erneut -> überspringen.
        maxUid = Math.max(maxUid, uid);
        continue;
      }
      maxUid = Math.max(maxUid, uid);
      if (!msg.source) continue;

      const parsed = await simpleParser(msg.source);
      const messageId = parsed.messageId ?? null;
      if (messageId) {
        const dup = await db.query.messages.findFirst({
          where: eq(schema.messages.messageId, messageId),
        });
        if (dup) continue;
      }

      const fromAddr = parsed.from?.value?.[0];
      const fromEmail = fromAddr?.address ?? "unknown";
      const fromName = fromAddr?.name || null;
      const subject = parsed.subject ?? null;
      const inReplyTo = parsed.inReplyTo ?? null;
      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : [];
      const refIds = [inReplyTo, ...references].filter(Boolean) as string[];

      await db.transaction(async (tx) => {
        const threadId = await resolveThreadId(shop.id, fromEmail, subject, refIds);
        await tx
          .insert(schema.messages)
          .values({
            threadId,
            direction: "inbound",
            fromEmail,
            toEmail: mb.fromEmail,
            subject,
            bodyText: parsed.text ?? null,
            bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
            messageId,
            inReplyTo,
          })
          .onConflictDoNothing();
        await tx
          .update(schema.threads)
          .set({
            lastMessageAt: new Date(),
            status: sql`case when ${schema.threads.status} = 'closed' then 'open' else ${schema.threads.status} end`,
            customerName: sql`coalesce(${schema.threads.customerName}, ${fromName})`,
          })
          .where(eq(schema.threads.id, threadId));
      });
      processed++;
    }
  } finally {
    lock.release();
  }

  if (maxUid > (mb.lastSeenUid ?? 0)) {
    await db
      .update(schema.shopMailboxes)
      .set({ lastSeenUid: maxUid, updatedAt: new Date() })
      .where(eq(schema.shopMailboxes.shopId, shop.id));
  }

  await client.logout();
  return processed;
}

export async function ingestAll(): Promise<number> {
  let total = 0;
  const shops = await db.select().from(schema.shops);
  for (const shop of shops) {
    try {
      total += await ingestShop(shop);
    } catch (err) {
      console.error(`[ingest] Shop ${shop.slug} Fehler:`, err);
    }
  }
  return total;
}
