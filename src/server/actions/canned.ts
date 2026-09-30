"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireUser, requireWrite, assertShopAccess } from "@/server/access";

export async function createCannedReply(shopId: string, title: string, body: string) {
  await requireWrite(shopId, "support");
  const t = title.trim();
  const b = body.trim();
  if (!t || !b) throw new Error("Titel und Anweisung nötig");
  await db.insert(schema.cannedReply).values({ shopId, title: t, body: b });
  revalidatePath("/textbausteine");
}

export async function deleteCannedReply(id: string) {
  const row = await db.query.cannedReply.findFirst({ where: eq(schema.cannedReply.id, id) });
  if (!row) return;
  await requireWrite(row.shopId, "support"); // Gäste (nur lesen) dürfen nicht löschen
  await db.delete(schema.cannedReply).where(eq(schema.cannedReply.id, id));
  revalidatePath("/textbausteine");
}
