// Textbausteine eines Brands laden (Lese-Helfer, kein "use server").
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type CannedReply = { id: string; title: string; body: string };

export async function listCannedReplies(shopId: string): Promise<CannedReply[]> {
  const rows = await db
    .select({ id: schema.cannedReply.id, title: schema.cannedReply.title, body: schema.cannedReply.body })
    .from(schema.cannedReply)
    .where(eq(schema.cannedReply.shopId, shopId))
    .orderBy(asc(schema.cannedReply.sort), asc(schema.cannedReply.createdAt));
  return rows;
}
