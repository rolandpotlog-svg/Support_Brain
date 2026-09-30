"use server";
// Herzschlag fürs Team-Protokoll: höchstens ein Eintrag pro Nutzer und Minute.
import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";
import { accessibleShopIds } from "@/server/access";

export async function pingActivity(): Promise<void> {
  try {
    const user = await requireUser();
    const shopId = await getActiveShopId(await accessibleShopIds(user));
    await db
      .insert(schema.userActiveMinute)
      .values({ userId: user.id, minute: sql`date_trunc('minute', now())`, shopId: shopId ?? null })
      .onConflictDoNothing();
  } catch {
    // nie stören
  }
}
