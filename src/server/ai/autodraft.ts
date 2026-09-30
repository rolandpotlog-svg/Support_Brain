// Auto-Entwurf: zu jeder neuen Kundenmail legt der Worker sofort einen KI-Entwurf ins Ticket.
// Gesendet wird NIE automatisch — ein Mensch prüft und gibt frei. Beim Senden wird gemessen,
// ob der Entwurf 1:1 rausging (verbatim) oder geändert wurde (edited) -> Reife fürs spätere Auto-Senden.
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured } from "@/server/ai";
import { generateDraft } from "@/server/ai/draft";

const MAX_PER_CYCLE = Number(process.env.AUTODRAFT_MAX_PER_CYCLE ?? 10);
// Nur frische Tickets — kein teures Nachziehen des ganzen Altbestands.
const MAX_AGE_HOURS = Number(process.env.AUTODRAFT_MAX_AGE_HOURS ?? 72);

let running = false;

export async function autoDraftRecent(): Promise<number> {
  if (!aiConfigured() || running) return 0;
  running = true;
  try {
    // Nur Shops, die Auto-Entwurf eingeschaltet haben, KI an (kein Kill-Switch) und Profil hinterlegt.
    const shops = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .innerJoin(schema.shopProfile, eq(schema.shopProfile.shopId, schema.shops.id))
      .where(and(eq(schema.shops.autoDraft, true), eq(schema.shops.killSwitch, false), eq(schema.shops.active, true)));
    if (!shops.length) return 0;

    const since = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000);
    const candidates = await db
      .select({ id: schema.threads.id, lastMessageAt: schema.threads.lastMessageAt })
      .from(schema.threads)
      .where(
        and(
          inArray(schema.threads.shopId, shops.map((s) => s.id)),
          eq(schema.threads.status, "open"),
          isNull(schema.threads.deletedAt),
          gte(schema.threads.lastMessageAt, since),
          // Noch kein Entwurf, oder der Kunde hat seitdem erneut geschrieben.
          or(isNull(schema.threads.aiDraftAt), lt(schema.threads.aiDraftAt, schema.threads.lastMessageAt)),
        ),
      )
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(MAX_PER_CYCLE * 3);

    let n = 0;
    for (const t of candidates) {
      if (n >= MAX_PER_CYCLE) break;
      // Nur wenn die letzte (nicht-interne) Nachricht vom Kunden kommt — sonst ist nichts zu beantworten.
      const last = await db
        .select({ direction: schema.messages.direction })
        .from(schema.messages)
        .where(and(eq(schema.messages.threadId, t.id), eq(schema.messages.internal, false)))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1);
      if (last[0]?.direction !== "inbound") continue;
      try {
        await generateDraft(t.id);
        n++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[autodraft] Ticket ${t.id}:`, msg);
        // Nicht in jedem Zyklus erneut versuchen (Kosten) — erst wieder bei neuer Kundenmail.
        await db
          .update(schema.threads)
          .set({ aiDraftAt: sql`now()`, aiDecision: "mensch", aiReason: `Auto-Entwurf fehlgeschlagen: ${msg.slice(0, 200)}` })
          .where(eq(schema.threads.id, t.id));
      }
    }
    return n;
  } finally {
    running = false;
  }
}
