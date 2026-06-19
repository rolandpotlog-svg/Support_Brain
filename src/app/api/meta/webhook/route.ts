/* eslint-disable @typescript-eslint/no-explicit-any */
// Meta-Webhook: GET = Verify-Handshake, POST = eingehende DMs (Messenger + Instagram).
// Code-komplett, aber inert bis eine Meta-App den Endpunkt aufruft.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { accountByPageId, verifyTokenMatches } from "@/server/social-config";
import { getMetaUserName, verifySignature } from "@/server/social/meta";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && (await verifyTokenMatches(token))) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const sig = req.headers.get("x-hub-signature-256");

  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id ?? "");
    const account = await accountByPageId(pageId);
    if (!account) continue;
    // Signatur prüfen, sofern App-Secret hinterlegt ist.
    if (account.appSecret && !verifySignature(account.appSecret, raw, sig)) continue;

    for (const ev of entry.messaging ?? []) {
      const senderId = String(ev.sender?.id ?? "");
      const msg = ev.message;
      if (!senderId || senderId === pageId || !msg || msg.is_echo) continue;

      const text: string = msg.text ?? "";
      const mid: string | null = msg.mid ?? null;

      let conv = await db.query.socialConversation.findFirst({
        where: and(
          eq(schema.socialConversation.accountId, account.id),
          eq(schema.socialConversation.externalUserId, senderId),
        ),
      });
      if (!conv) {
        const userName = await getMetaUserName(account.accessToken, senderId);
        const [created] = await db
          .insert(schema.socialConversation)
          .values({
            shopId: account.shopId,
            accountId: account.id,
            channel: account.channel,
            externalUserId: senderId,
            userName,
            lastInboundAt: new Date(),
          })
          .returning();
        conv = created;
      } else {
        await db
          .update(schema.socialConversation)
          .set({ lastInboundAt: new Date(), lastMessageAt: new Date(), status: "open" })
          .where(eq(schema.socialConversation.id, conv.id));
      }

      await db
        .insert(schema.socialMessage)
        .values({ conversationId: conv.id, direction: "inbound", text, externalId: mid })
        .onConflictDoNothing();
    }
  }
  return new Response("ok", { status: 200 });
}
