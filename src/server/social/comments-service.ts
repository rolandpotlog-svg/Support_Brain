// Kommentar-Service: KI-Klassifizierung + öffentlich-tauglicher Entwurf + Ingest
// (klassifizieren -> routen -> entwerfen, ggf. auto-posten). Nutzt Shop-Profil + KI mit.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured, complete } from "@/server/ai";
import { buildSystemPrompt, emptyProfile } from "@/lib/profile/types";
import { replyToComment } from "@/server/social/meta";
import type { SocialCreds } from "@/server/social-config";
import {
  AUTO_CONFIDENCE_MIN,
  COMMENT_INTENTS,
  isAutoSafe,
  normalizeIntent,
  routeForIntent,
  type CommentIntent,
} from "@/lib/social/comments";

export type CommentClass = { intent: CommentIntent; sentiment: string; confidence: number };

export async function classifyComment(text: string): Promise<CommentClass> {
  if (!aiConfigured() || !text.trim()) return { intent: "offtopic", sentiment: "neutral", confidence: 0 };
  const system =
    "Du klassifizierst öffentliche Facebook-Kommentare unter den Werbeanzeigen/Posts eines Shops. " +
    "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown.";
  const user =
    `Kategorie (genau eine): ${COMMENT_INTENTS.join(" | ")}\n` +
    `Sentiment: positiv | neutral | negativ\n` +
    `confidence: 0-100 (wie sicher die Einordnung ist)\n\n` +
    `Antworte exakt: {"intent":"…","sentiment":"…","confidence":0}\n\nKOMMENTAR:\n${text.slice(0, 800)}`;
  const raw = await complete({ system, messages: [{ role: "user", content: user }], maxTokens: 300, effort: "low" });
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  try {
    const o = JSON.parse(a >= 0 && b > a ? raw.slice(a, b + 1) : raw) as Record<string, unknown>;
    const confidence = Math.max(0, Math.min(100, Math.round(Number(o.confidence) || 0)));
    const sentiment = ["positiv", "neutral", "negativ"].includes(String(o.sentiment)) ? String(o.sentiment) : "neutral";
    return { intent: normalizeIntent(String(o.intent)), sentiment, confidence };
  } catch {
    return { intent: "offtopic", sentiment: "neutral", confidence: 0 };
  }
}

/** Kurzer, öffentlich-tauglicher (oder privater) Antwortentwurf im Marken-Ton. */
export async function draftCommentReply(
  shopId: string,
  message: string,
  visibility: "public" | "private",
): Promise<string> {
  if (!aiConfigured()) return "";
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const profile = await db.query.shopProfile.findFirst({ where: eq(schema.shopProfile.shopId, shopId) });
  const base = profile?.systemPrompt || buildSystemPrompt(emptyProfile(), shop?.name ?? "unser Shop");
  const rules =
    visibility === "public"
      ? "\n\n--- AUSGABE-REGELN (ÖFFENTLICHER FB-KOMMENTAR) ---\n" +
        "Antworte ÖFFENTLICH und sehr kurz (1–2 Sätze), freundlich und markengerecht. " +
        "Keine internen Details, keine erfundenen Beträge/Fristen/Tracking. Kein Smalltalk, keine Hashtags-Flut. " +
        "Bei Unsicherheit lieber zum Support/DM einladen. Gib NUR den Antworttext aus."
      : "\n\n--- AUSGABE-REGELN (PRIVATE ANTWORT / DM) ---\n" +
        "Verfasse eine kurze, freundliche PRIVATE Antwort. Bitte den Kunden, dir per DM/Support die Details zu schicken, " +
        "damit ihr das persönlich klärt. Nichts erfinden. Gib NUR den Antworttext aus.";
  return complete({
    system: base + rules,
    messages: [{ role: "user", content: `KOMMENTAR: ${message}\n\nVerfasse die Antwort.` }],
    maxTokens: 400,
    effort: "low",
  });
}

async function autonomyEnabled(shopId: string, category: string): Promise<boolean> {
  const row = await db.query.socialCategoryAutonomy.findFirst({
    where: and(eq(schema.socialCategoryAutonomy.shopId, shopId), eq(schema.socialCategoryAutonomy.category, category)),
  });
  return Boolean(row?.autoEnabled);
}

export type IncomingComment = {
  commentId: string;
  postId: string | null;
  adId: string | null;
  parentId: string | null;
  fromId: string | null;
  fromName: string | null;
  message: string | null;
};

/** Neuen Kommentar verarbeiten: dedup -> klassifizieren -> routen -> entwerfen (ggf. auto-posten). */
export async function ingestComment(account: SocialCreds, c: IncomingComment): Promise<void> {
  const existing = await db.query.socialComment.findFirst({
    where: eq(schema.socialComment.commentId, c.commentId),
  });
  if (existing) return;

  const cls = await classifyComment(c.message ?? "");
  const route = routeForIntent(cls.intent);

  let status = "new";
  let visibility: string | null = null;
  let draftText: string | null = null;
  let postedText: string | null = null;
  let auto = false;

  if (route === "public_reply") {
    visibility = "public";
    draftText = await draftCommentReply(account.shopId, c.message ?? "", "public");
    const canAuto =
      !account.autoStop &&
      isAutoSafe(cls.intent) &&
      cls.confidence >= AUTO_CONFIDENCE_MIN &&
      (await autonomyEnabled(account.shopId, cls.intent));
    if (canAuto && draftText) {
      try {
        await replyToComment(account, c.commentId, draftText);
        status = "posted";
        postedText = draftText;
        auto = true;
      } catch {
        status = "drafted"; // inert/ohne Token -> bleibt Entwurf für den Menschen
      }
    } else {
      status = "drafted";
    }
  } else if (route === "private_or_human") {
    visibility = "private";
    draftText = await draftCommentReply(account.shopId, c.message ?? "", "private");
    status = "drafted";
  } else {
    // hide / skip -> immer Mensch (kein Auto-Engagement)
    status = "new";
  }

  await db
    .insert(schema.socialComment)
    .values({
      shopId: account.shopId,
      accountId: account.id,
      postId: c.postId,
      adId: c.adId,
      commentId: c.commentId,
      parentCommentId: c.parentId,
      fromId: c.fromId,
      fromName: c.fromName,
      message: c.message,
      intent: cls.intent,
      sentiment: cls.sentiment,
      confidence: cls.confidence,
      routeAction: route,
      visibility,
      status,
      draftText,
      postedText,
      auto,
    })
    .onConflictDoNothing();
}
