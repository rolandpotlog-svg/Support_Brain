// Lese-Helfer für den Social-Bereich.
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type SocialConvRow = {
  id: string;
  channel: string;
  userName: string | null;
  customerName: string | null;
  status: string;
  lastInboundAt: Date | null;
  lastMessageAt: Date;
};

export async function listConversations(shopId: string): Promise<SocialConvRow[]> {
  return db
    .select({
      id: schema.socialConversation.id,
      channel: schema.socialConversation.channel,
      userName: schema.socialConversation.userName,
      customerName: schema.socialConversation.customerName,
      status: schema.socialConversation.status,
      lastInboundAt: schema.socialConversation.lastInboundAt,
      lastMessageAt: schema.socialConversation.lastMessageAt,
    })
    .from(schema.socialConversation)
    .where(eq(schema.socialConversation.shopId, shopId))
    .orderBy(desc(schema.socialConversation.lastMessageAt))
    .limit(100);
}

export type SocialMsg = {
  id: string;
  direction: "inbound" | "outbound";
  text: string | null;
  createdAt: string;
};

export async function loadConversation(id: string) {
  const conv = await db.query.socialConversation.findFirst({
    where: eq(schema.socialConversation.id, id),
  });
  if (!conv) return null;
  const rows = await db
    .select({
      id: schema.socialMessage.id,
      direction: schema.socialMessage.direction,
      text: schema.socialMessage.text,
      createdAt: schema.socialMessage.createdAt,
    })
    .from(schema.socialMessage)
    .where(eq(schema.socialMessage.conversationId, id))
    .orderBy(schema.socialMessage.createdAt);
  const messages: SocialMsg[] = rows.map((m) => ({
    id: m.id,
    direction: m.direction,
    text: m.text,
    createdAt: m.createdAt.toISOString(),
  }));
  return { conv, messages };
}
