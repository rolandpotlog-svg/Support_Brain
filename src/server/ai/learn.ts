// Lern-Loop: aus jeder geänderten KI-Antwort (Mitarbeiter hat den Entwurf bearbeitet) und jeder Abweichung im
// Schattenbetrieb eine allgemeine Regel VORSCHLAGEN. Freigabe durch einen Admin -> Regel fließt in jeden Entwurf.
// Gleiche Korrekturen werden gebündelt (hits++), statt doppelte Regeln zu erzeugen.
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured, complete } from "@/server/ai";
import { stripQuoted } from "@/server/ai/shadow-compare";

const MAX_PER_CYCLE = 10;
let running = false;

const SYSTEM =
  "Du verbesserst einen KI-Kundensupport. Du bekommst den KI-Entwurf und die Antwort, die der Mitarbeiter tatsächlich gesendet hat. " +
  "Leite daraus höchstens EINE allgemeine, wiederverwendbare Regel ab, die die KI künftig befolgen soll (z. B. „Bei beschädigter Box immer ein Foto anfordern und kostenlosen Ersatz zusagen“ oder „Bei Nachfrage zur Lieferung keinen zweiten Rabattcode anbieten“). " +
  "KEINE Regel, wenn die Änderung nur Tippfehler, Formatierung, Namen oder fallspezifische Fakten betrifft. " +
  "Ist die Regel inhaltlich schon in den bestehenden Regeln enthalten, gib deren Nummer zurück statt einer neuen. " +
  'Antworte NUR mit JSON: {"rule":"… oder null","same_as":null oder Nummer,"intent_only":true|false}';

async function propose(opts: {
  shopId: string;
  threadId: string;
  intent: string | null;
  draft: string;
  actual: string;
  source: "edit" | "shadow";
  note?: string | null;
}): Promise<"new" | "hit" | "none"> {
  const existing = await db
    .select({ id: schema.shopLesson.id, rule: schema.shopLesson.rule })
    .from(schema.shopLesson)
    .where(and(eq(schema.shopLesson.shopId, opts.shopId), inArray(schema.shopLesson.status, ["vorschlag", "aktiv"])))
    .orderBy(desc(schema.shopLesson.createdAt))
    .limit(60);
  const raw = await complete({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `ANLIEGEN: ${opts.intent ?? "unbekannt"}`,
          opts.note ? `HINWEIS AUS DEM VERGLEICH: ${opts.note}` : "",
          "",
          "BESTEHENDE REGELN:",
          existing.length ? existing.map((e, i) => `${i + 1}. ${e.rule}`).join("\n") : "(keine)",
          "",
          "KI-ENTWURF:",
          opts.draft.slice(0, 4000),
          "",
          "TATSÄCHLICH GESENDET:",
          opts.actual.slice(0, 4000),
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    maxTokens: 1200,
    effort: "low",
    kind: "lernen",
    shopId: opts.shopId,
  });
  let j: { rule?: string | null; same_as?: number | null; intent_only?: boolean } = {};
  try {
    j = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return "none";
  }
  if (j.same_as && existing[j.same_as - 1]) {
    await db
      .update(schema.shopLesson)
      .set({ hits: sql`${schema.shopLesson.hits} + 1` })
      .where(eq(schema.shopLesson.id, existing[j.same_as - 1].id));
    return "hit";
  }
  const rule = typeof j.rule === "string" ? j.rule.trim() : "";
  if (!rule || rule.toLowerCase() === "null") return "none";
  await db.insert(schema.shopLesson).values({
    shopId: opts.shopId,
    intent: j.intent_only ? opts.intent : null,
    rule: rule.slice(0, 500),
    source: opts.source,
    status: "vorschlag",
    threadId: opts.threadId,
    evidence: `KI: ${opts.draft.slice(0, 600)}\n\n---\nGesendet: ${opts.actual.slice(0, 600)}`,
  });
  return "new";
}

/** Worker: geänderte Entwürfe + Schattenbetrieb-Abweichungen der letzten 7 Tage auf Regeln prüfen (einmalig je Antwort). */
export async function learnFromEdits(): Promise<number> {
  if (!aiConfigured() || running) return 0;
  running = true;
  try {
    const rows = await db
      .select({
        id: schema.messages.id,
        threadId: schema.messages.threadId,
        draft: schema.messages.aiDraft,
        body: schema.messages.bodyText,
        outcome: schema.messages.aiOutcome,
        shadowMatch: schema.messages.aiShadowMatch,
        shadowNote: schema.messages.aiShadowNote,
        shopId: schema.threads.shopId,
        intent: schema.threads.aiIntent,
      })
      .from(schema.messages)
      .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
      .where(
        and(
          eq(schema.messages.direction, "outbound"),
          isNotNull(schema.messages.aiDraft),
          isNull(schema.messages.lessonCheckedAt),
          gte(schema.messages.createdAt, new Date(Date.now() - 7 * 86_400_000)),
          or(eq(schema.messages.aiOutcome, "edited"), and(eq(schema.messages.aiOutcome, "shadow"), eq(schema.messages.aiShadowMatch, false))),
        ),
      )
      .limit(MAX_PER_CYCLE);
    let n = 0;
    for (const r of rows) {
      try {
        await propose({
          shopId: r.shopId,
          threadId: r.threadId,
          intent: r.intent,
          draft: r.draft ?? "",
          actual: stripQuoted(r.body ?? "") || (r.body ?? ""),
          source: r.outcome === "shadow" ? "shadow" : "edit",
          note: r.shadowNote,
        });
        n++;
      } catch (e) {
        console.error(`[learn] ${r.id}:`, e instanceof Error ? e.message : e);
      }
      await db.update(schema.messages).set({ lessonCheckedAt: new Date() }).where(eq(schema.messages.id, r.id));
    }
    return n;
  } finally {
    running = false;
  }
}

/** Aktive Regeln eines Shops für den Entwurfs-Prompt (allgemeine + die zum Anliegen). */
export async function activeLessonsForPrompt(shopId: string, intent: string | null): Promise<string> {
  const rows = await db
    .select({ rule: schema.shopLesson.rule, intent: schema.shopLesson.intent })
    .from(schema.shopLesson)
    .where(and(eq(schema.shopLesson.shopId, shopId), eq(schema.shopLesson.status, "aktiv")))
    .orderBy(desc(schema.shopLesson.hits))
    .limit(60);
  const rel = rows.filter((r) => !r.intent || r.intent === intent);
  if (!rel.length) return "";
  return (
    "\n\n--- GELERNTE REGELN DIESES SHOPS (vom Team bestätigt — haben VORRANG vor allem anderen) ---\n" +
    rel.map((r) => `- ${r.rule}`).join("\n")
  );
}
