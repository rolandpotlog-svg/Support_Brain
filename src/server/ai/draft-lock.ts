// Sperre „Entwurf läuft gerade“ je Ticket: Worker und Posteingang erzeugen nie gleichzeitig denselben Entwurf.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

/** true = diese Stelle darf jetzt entwerfen (Sperre gesetzt). Verfällt nach 2 Minuten von selbst. */
export async function claimDrafting(threadId: string): Promise<boolean> {
  const r = await db
    .update(schema.threads)
    .set({ aiDraftingAt: sql`now()` })
    .where(
      and(
        eq(schema.threads.id, threadId),
        sql`(${schema.threads.aiDraftingAt} is null or ${schema.threads.aiDraftingAt} < now() - interval '2 minutes')`,
      ),
    )
    .returning({ id: schema.threads.id });
  return r.length > 0;
}

export async function releaseDrafting(threadId: string): Promise<void> {
  await db.update(schema.threads).set({ aiDraftingAt: null }).where(eq(schema.threads.id, threadId)).catch(() => null);
}
