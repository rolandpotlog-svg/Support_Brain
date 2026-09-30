// Anliegen-Erkennung je Ticket („Standard-Mails“): bei jeder neuen Kundenmail den GANZEN Verlauf lesen und
// Anliegen, genaues Problem, betroffenen Artikel, Stimmung, Sprache, Lob + Kurz-Zusammenfassung speichern.
// Läuft im Worker vor dem KI-Entwurf. Füttert auch die alten Report-Felder (aiCategory/aiSentiment/aiProduct).
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { aiConfigured, complete } from "@/server/ai";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { stripQuoted } from "@/server/ai/shadow-compare";
import { INTENTS, intentCategory, normalizeIntent } from "@/lib/support/intents";
import type { OrderItem } from "@/server/order-link";

const SENTIMENTS = new Set(["positiv", "neutral", "negativ"]);
const MAX_PER_CYCLE = 20;
let running = false;

const SYSTEM =
  "Du ordnest E-Commerce-Kundenanfragen ein (Schmuck/Geschenke, deutschsprachige Kunden). Lies den GESAMTEN Verlauf; " +
  "maßgeblich ist das AKTUELLE Anliegen der letzten Kundennachricht (z. B. erst „wo ist mein Paket“, dann „ist angekommen, aber beschädigt“ -> beschaedigt). " +
  "Antworte AUSSCHLIESSLICH mit JSON, ohne Markdown.";

function prompt(opts: {
  subject: string;
  history: string;
  items: OrderItem[];
  knownIssues: string[];
}): string {
  return [
    "ANLIEGEN (genau einen key wählen):",
    ...INTENTS.map((i) => `- ${i.key}: ${i.label}`),
    "",
    "Felder:",
    '- intent: key von oben',
    '- issue: genaues Problem in 2–4 Wörtern auf Deutsch (z. B. „Verschluss defekt“, „Box beschädigt“, „Kette gerissen“, „Gravur fehlt“, „Paket hängt im Zoll“), sonst null. ' +
      "Wenn eines dieser bereits bekannten Probleme gemeint ist, EXAKT denselben Wortlaut verwenden: " +
      (opts.knownIssues.length ? opts.knownIssues.map((k) => `„${k}“`).join(", ") : "(noch keine)"),
    "- item: betroffener Artikel. Wenn Bestellartikel unten stehen, EXAKT einen dieser Titel wählen (der gemeint ist); sonst kurz der vom Kunden genannte Artikel oder null",
    "- sentiment: positiv | neutral | negativ",
    "- language: ISO-Sprachcode der Kundennachricht (de, en, …)",
    "- praise: true, wenn der Kunde das Produkt/den Service lobt",
    "- summary: ein Satz auf Deutsch, was der Kunde JETZT will (max. 15 Wörter)",
    "",
    'Format: {"intent":"…","issue":null,"item":null,"sentiment":"neutral","language":"de","praise":false,"summary":"…"}',
    "",
    opts.items.length
      ? "BESTELLARTIKEL:\n" + opts.items.map((i) => `- ${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}`).join("\n")
      : "BESTELLARTIKEL: (keine Bestellung zugeordnet)",
    "",
    `BETREFF: ${opts.subject}`,
    "VERLAUF:",
    opts.history,
  ].join("\n");
}

/** Ein Ticket einordnen und speichern. */
export async function triageThread(threadId: string): Promise<void> {
  const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!t) return;
  const msgs = await db
    .select({ direction: schema.messages.direction, internal: schema.messages.internal, bodyText: schema.messages.bodyText, bodyHtml: schema.messages.bodyHtml })
    .from(schema.messages)
    .where(eq(schema.messages.threadId, threadId))
    .orderBy(schema.messages.createdAt);
  const history = msgs
    .filter((m) => !m.internal)
    .slice(-8)
    .map((m) => {
      const txt = bestBodyText(m.bodyText, m.bodyHtml) ?? "";
      return `${m.direction === "inbound" ? "Kunde" : "Support"}: ${(stripQuoted(txt) || txt).slice(0, 1500)}`;
    })
    .join("\n\n");

  // Bereits bekannte Problem-Namen dieses Shops -> gleiche Probleme bekommen denselben Namen (für die Analyse).
  const known = await db
    .select({ issue: schema.threads.aiIssue, n: sql<number>`count(*)::int` })
    .from(schema.threads)
    .where(and(eq(schema.threads.shopId, t.shopId), isNotNull(schema.threads.aiIssue), gte(schema.threads.createdAt, new Date(Date.now() - 120 * 86_400_000))))
    .groupBy(schema.threads.aiIssue)
    .orderBy(desc(sql`count(*)`))
    .limit(40);

  const raw = await complete({
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: prompt({
          subject: t.subject ?? "",
          history: history || "(kein Text)",
          items: (t.orderItems as OrderItem[] | null) ?? [],
          knownIssues: known.map((k) => k.issue!).filter(Boolean),
        }),
      },
    ],
    maxTokens: 1500,
    effort: "low",
  });

  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    j = {}; // unlesbar -> „sonstiges“, aber als eingeordnet markieren (kein Endlos-Retry)
  }
  const intent = normalizeIntent(String(j.intent ?? ""));
  const sentiment = SENTIMENTS.has(String(j.sentiment)) ? String(j.sentiment) : "neutral";
  const issue = typeof j.issue === "string" && j.issue.trim() ? j.issue.trim().slice(0, 60) : null;
  let item = typeof j.item === "string" && j.item.trim() ? j.item.trim().slice(0, 200) : null;
  // Auf den exakten Shopify-Titel normalisieren (ohne Variante) — damit die Produktanalyse sauber zählt.
  const orderItems = (t.orderItems as OrderItem[] | null) ?? [];
  if (item) {
    const hit = orderItems.find((o) => item!.toLowerCase().startsWith(o.title.toLowerCase()));
    if (hit) item = hit.title;
  }
  const now = new Date();
  await db
    .update(schema.threads)
    .set({
      aiIntent: intent,
      aiIssue: issue,
      aiItem: item,
      aiSummary: typeof j.summary === "string" ? j.summary.slice(0, 200) : null,
      aiLanguage: typeof j.language === "string" ? j.language.slice(0, 5) : null,
      aiPraise: j.praise === true,
      aiTriagedAt: now,
      // Alte Report-Felder weiter befüllen (Themen/Stimmung/Produkt im Report + Wochenbericht).
      aiCategory: intentCategory(intent),
      aiSentiment: sentiment,
      aiProduct: item,
      aiClassifiedAt: now,
      // Tag nur setzen, wenn noch keiner gesetzt ist (manuelle Tags bleiben).
      tag: sql`coalesce(${schema.threads.tag}, ${intentCategory(intent)})`,
    })
    .where(eq(schema.threads.id, threadId));
}

/** Worker: alle Tickets mit neuer Kundenmail einordnen (Shops mit Auto-Tag ODER Auto-Entwurf). */
export async function triageRecent(): Promise<number> {
  if (!aiConfigured() || running) return 0;
  running = true;
  try {
    const shops = await db
      .select({ id: schema.shops.id })
      .from(schema.shops)
      .where(and(eq(schema.shops.active, true), eq(schema.shops.killSwitch, false), or(eq(schema.shops.autoTag, true), eq(schema.shops.autoDraft, true))));
    if (!shops.length) return 0;
    const since = new Date(Date.now() - 72 * 3_600_000);
    const todo = await db
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(
        and(
          inArray(schema.threads.shopId, shops.map((s) => s.id)),
          isNull(schema.threads.deletedAt),
          gte(schema.threads.lastMessageAt, since),
          or(isNull(schema.threads.aiTriagedAt), lt(schema.threads.aiTriagedAt, schema.threads.lastMessageAt)),
        ),
      )
      .orderBy(desc(schema.threads.lastMessageAt))
      .limit(MAX_PER_CYCLE);
    let n = 0;
    for (const t of todo) {
      // Nur wenn die letzte (nicht-interne) Nachricht vom Kunden kommt — eigene Antworten nicht neu einordnen.
      const last = await db
        .select({ direction: schema.messages.direction })
        .from(schema.messages)
        .where(and(eq(schema.messages.threadId, t.id), eq(schema.messages.internal, false)))
        .orderBy(desc(schema.messages.createdAt))
        .limit(1);
      if (last[0]?.direction !== "inbound") {
        await db.update(schema.threads).set({ aiTriagedAt: new Date() }).where(eq(schema.threads.id, t.id));
        continue;
      }
      try {
        await triageThread(t.id);
        n++;
      } catch (e) {
        console.error(`[triage] ${t.id}:`, e instanceof Error ? e.message : e);
        // Nicht in jedem Zyklus erneut versuchen (Kosten) — erst wieder bei neuer Kundenmail.
        await db.update(schema.threads).set({ aiTriagedAt: new Date() }).where(eq(schema.threads.id, t.id));
      }
    }
    return n;
  } finally {
    running = false;
  }
}
