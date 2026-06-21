"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";
import { loadSocialCreds } from "@/server/social-config";
import { hideComment, privateReplyToComment, replyToComment } from "@/server/social/meta";
import { AUTONOMY_THRESHOLD, isAutoSafe, normalizeIntent } from "@/lib/social/comments";

async function loadComment(commentRowId: string) {
  const user = await requireUser();
  const c = await db.query.socialComment.findFirst({ where: eq(schema.socialComment.id, commentRowId) });
  if (!c) throw new Error("Kommentar nicht gefunden");
  await assertShopAccess(user, c.shopId);
  return { user, c };
}

/** Erfolgreiche Freigabe zählen; ab Schwelle Kategorie auf Auto (nur sichere Kategorien). */
async function bumpAutonomy(shopId: string, intent: string | null) {
  const category = normalizeIntent(intent);
  if (!isAutoSafe(category)) return; // Beschwerde etc. werden nie auto-fähig
  const row = await db.query.socialCategoryAutonomy.findFirst({
    where: and(eq(schema.socialCategoryAutonomy.shopId, shopId), eq(schema.socialCategoryAutonomy.category, category)),
  });
  if (!row) {
    await db.insert(schema.socialCategoryAutonomy).values({ shopId, category, approvedCount: 1 });
    return;
  }
  const count = row.approvedCount + 1;
  await db
    .update(schema.socialCategoryAutonomy)
    .set({ approvedCount: count, autoEnabled: row.autoEnabled || count >= AUTONOMY_THRESHOLD, updatedAt: new Date() })
    .where(eq(schema.socialCategoryAutonomy.id, row.id));
}

/** Öffentliche Antwort freigeben & posten (best-effort über Graph). Zählt als Freigabe. */
export async function postCommentReply(commentRowId: string, text: string): Promise<{ posted: boolean; warn?: string }> {
  const { user, c } = await loadComment(commentRowId);
  if (!text.trim()) throw new Error("Leere Antwort");

  let posted = false;
  let warn: string | undefined;
  const creds = await loadSocialCreds(c.accountId);
  if (creds) {
    try {
      await replyToComment(creds, c.commentId, text);
      posted = true;
    } catch (e) {
      warn = `Meta-Post nicht möglich (noch nicht verbunden?): ${e instanceof Error ? e.message : e}`;
    }
  } else {
    warn = "Meta-Account nicht verbunden — als gepostet markiert (geht live, sobald verbunden).";
  }

  await db
    .update(schema.socialComment)
    .set({ status: "posted", postedText: text, handledBy: user.id, updatedAt: new Date() })
    .where(eq(schema.socialComment.id, c.id));
  await bumpAutonomy(c.shopId, c.intent); // menschliche Freigabe = Lernsignal
  revalidatePath("/social/comments");
  return { posted, warn };
}

/** Privat (DM) antworten. */
export async function sendPrivateReply(commentRowId: string, text: string): Promise<{ warn?: string }> {
  const { user, c } = await loadComment(commentRowId);
  if (!text.trim()) throw new Error("Leere Antwort");
  let warn: string | undefined;
  const creds = await loadSocialCreds(c.accountId);
  if (creds) {
    try {
      await privateReplyToComment(creds, c.commentId, text);
    } catch (e) {
      warn = `Private Antwort nicht möglich: ${e instanceof Error ? e.message : e}`;
    }
  }
  await db
    .update(schema.socialComment)
    .set({ status: "private_sent", postedText: text, handledBy: user.id, updatedAt: new Date() })
    .where(eq(schema.socialComment.id, c.id));
  revalidatePath("/social/comments");
  return { warn };
}

export async function hideCommentAction(commentRowId: string): Promise<void> {
  const { user, c } = await loadComment(commentRowId);
  const creds = await loadSocialCreds(c.accountId);
  if (creds) {
    try {
      await hideComment(creds, c.commentId, true);
    } catch {
      /* inert/ohne Token -> trotzdem als ausgeblendet markieren */
    }
  }
  await db
    .update(schema.socialComment)
    .set({ status: "hidden", handledBy: user.id, updatedAt: new Date() })
    .where(eq(schema.socialComment.id, c.id));
  revalidatePath("/social/comments");
}

export async function escalateComment(commentRowId: string): Promise<void> {
  const { user, c } = await loadComment(commentRowId);
  await db
    .update(schema.socialComment)
    .set({ status: "escalated", handledBy: user.id, updatedAt: new Date() })
    .where(eq(schema.socialComment.id, c.id));
  revalidatePath("/social/comments");
}

export async function discardComment(commentRowId: string): Promise<void> {
  const { user, c } = await loadComment(commentRowId);
  await db
    .update(schema.socialComment)
    .set({ status: "skipped", handledBy: user.id, updatedAt: new Date() })
    .where(eq(schema.socialComment.id, c.id));
  revalidatePath("/social/comments");
}

/** Not-Aus pro Shop-Account: true => alles zurück auf Entwurf (kein Auto-Posten). */
export async function setSocialAutoStop(accountId: string, on: boolean): Promise<void> {
  const user = await requireUser();
  const a = await db.query.socialAccount.findFirst({ where: eq(schema.socialAccount.id, accountId) });
  if (!a) throw new Error("Account nicht gefunden");
  await assertShopAccess(user, a.shopId);
  await db
    .update(schema.socialAccount)
    .set({ autoStop: on, updatedAt: new Date() })
    .where(eq(schema.socialAccount.id, accountId));
  revalidatePath("/social/comments");
}
