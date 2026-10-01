// Prüfung jedes KI-Entwurfs, bevor er (später) automatisch rausgehen darf. Drei Stufen:
// 1) Fakten (ohne KI): jede Nummer, jeder Link, jeder Code, jeder Betrag im Entwurf muss in den Daten stehen.
// 2) Harte Sperren: Fälle, die NIE automatisch beantwortet werden (Anhang, 3. Beschwerde, unsichere Bestellung …).
// 3) Prüfer-KI: unabhängiger zweiter Blick — „würde der Inhaber das so abschicken?“
// Ergebnis steht am Ticket (threads.ai_check) und wird beim Senden mitgemessen (messages.ai_check_passed).
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { complete } from "@/server/ai";

export type DraftCheck = {
  passed: boolean; // Fakten ok UND Prüfer ok
  facts: string[]; // gefundene Faktenfehler
  blocks: string[]; // Gründe, warum der Fall nie automatisch rausgehen darf
  reviewer: { ok: boolean; issues: string[] } | null; // null = Prüfer nicht gelaufen/fehlgeschlagen
  autoEligible: boolean; // bestanden + keine Sperre + KI-Entscheidung AUTO
  at: string;
  ms: number;
};

/** Anliegen, die nie automatisch beantwortet werden (Geld, Mangel, Streit). */
export const NEVER_AUTO = new Set(["nicht_erhalten", "beschaedigt", "defekt", "gravur_fehler", "falsch_fehlt", "retoure", "nicht_wie_erwartet"]);
/** Anliegen, die eine sicher zugeordnete Bestellung brauchen. */
const ORDER_INTENTS = new Set(["wismo", "nachfrage", "adresse", "storno", "zahlung", "gravur_angaben"]);
const FORBIDDEN = [/dropshipping/i, /aliexpress/i, /lieferant(en)? aus china/i, /china-lieferant/i, /fulfillment/i];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

/** Stufe 1: Fakten gegen Kontext (Ticket, Shopify, Profil) prüfen — rein mechanisch, keine KI. */
export function factCheck(body: string, context: string): string[] {
  const ctx = norm(context);
  const ctxDigits = context.replace(/\D/g, " ");
  const issues: string[] = [];

  // Links: müssen wörtlich (ohne Satzzeichen am Ende) in Daten/Profil vorkommen
  for (const raw of body.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []) {
    const url = raw.replace(/[.,;:!?]+$/, "");
    if (!ctx.includes(url.toLowerCase())) issues.push(`Link nicht aus den Daten: ${url}`);
  }
  // Sendungs-/Bestellnummern: lange Ziffernfolgen (ggf. mit Buchstaben-Präfix) müssen in den Daten stehen
  for (const tok of body.match(/\b[A-Z]{0,4}\d{6,}[A-Z]{0,3}\b/g) ?? []) {
    const digits = tok.replace(/\D/g, "");
    if (!ctx.includes(tok.toLowerCase()) && !ctxDigits.includes(digits)) issues.push(`Nummer nicht in den Daten: ${tok}`);
  }
  for (const tok of body.match(/#\d{3,}/g) ?? []) {
    if (!ctx.includes(tok)) issues.push(`Bestellnummer nicht in den Daten: ${tok}`);
  }
  // Rabatt-/Gutscheincodes (Großbuchstaben + Ziffern, z. B. SORRY20): nur, wenn im Profil/Verlauf erlaubt genannt
  for (const tok of body.match(/\b[A-Za-z_]*[A-Z]{3,}[A-Za-z_]*\d{1,3}[A-Za-z_]*\b/g) ?? []) {
    if (!ctx.includes(tok.toLowerCase())) issues.push(`Code nicht freigegeben: ${tok}`);
  }
  // Geldbeträge: müssen in den Daten stehen (Komma/Punkt egal)
  for (const m of body.match(/\d{1,4}(?:[.,]\d{2})\s?(?:€|eur\b)|€\s?\d{1,4}(?:[.,]\d{2})?/gi) ?? []) {
    const n = m.replace(/[^\d.,]/g, "").replace(",", ".");
    const variants = [n, n.replace(".", ",")];
    if (!variants.some((v) => ctx.includes(v))) issues.push(`Betrag nicht in den Daten: ${m.trim()}`);
  }
  for (const re of FORBIDDEN) if (re.test(body)) issues.push(`Verbotenes Wort: ${body.match(re)?.[0]}`);
  return [...new Set(issues)];
}

/** Stufe 2: harte Sperren aus dem Ticket-Zustand. */
async function hardBlocks(threadId: string, decision: "auto" | "mensch"): Promise<string[]> {
  const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!t) return ["Ticket nicht gefunden"];
  const blocks: string[] = [];
  if (decision === "mensch") blocks.push("KI sagt: Mensch entscheidet");
  if (t.aiIntent && NEVER_AUTO.has(t.aiIntent)) blocks.push("Anliegen wird nie automatisch beantwortet");
  // Bestellbezogene Anliegen nur mit sicher zugeordneter Bestellung (sonst könnten fremde Daten rausgehen)
  if (t.orderConfidence && t.orderConfidence !== "sicher") blocks.push("Bestellung nicht sicher zugeordnet");
  else if (!t.orderConfidence && t.aiIntent && ORDER_INTENTS.has(t.aiIntent)) blocks.push("Keine Bestellung zugeordnet");

  const msgs = await db
    .select({ id: schema.messages.id, direction: schema.messages.direction, aiOutcome: schema.messages.aiOutcome })
    .from(schema.messages)
    .where(and(eq(schema.messages.threadId, threadId), eq(schema.messages.internal, false)))
    .orderBy(desc(schema.messages.createdAt));
  const inbound = msgs.filter((m) => m.direction === "inbound");
  if (inbound.length >= 3) blocks.push("Kunde hat schon 3× oder öfter geschrieben");
  const lastOut = msgs.find((m) => m.direction === "outbound");
  if (lastOut?.aiOutcome === "auto") blocks.push("Letzte Antwort war schon automatisch");
  if (inbound[0]) {
    const att = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.messageAttachment)
      .where(eq(schema.messageAttachment.messageId, inbound[0].id));
    if ((att[0]?.n ?? 0) > 0) blocks.push("Kunde hat Anhang/Foto geschickt");
  }
  return blocks;
}

const REVIEWER =
  "Du bist die unabhängige Qualitätsprüfung eines Online-Shops. Du bekommst die Shop-Richtlinien, die Kundenanfrage mit allen Daten und einen Antwortentwurf. " +
  "Prüfe NUR, ob der Entwurf so an den Kunden gehen darf. Durchfallen lassen bei: erfundenen oder falschen Fakten (Status, Termine, Nummern, Aktionen, die nicht belegt sind); " +
  "Zusagen über die Richtlinien hinaus (Erstattung, Ersatz, Rabatte außer den erlaubten, Fristen); Antwort geht an der eigentlichen Frage vorbei; Widerspruch zum Verlauf (z. B. Code doppelt, frühere Zusage ignoriert); " +
  "falscher Ton (unhöflich, belehrend, Haftungsabwehr), falsche Anrede (Du/Sie), falsche Sprache; interne Details (Lieferant, Dropshipping). " +
  "Stilfragen und Geschmack sind KEIN Grund zum Durchfallen. Antworte NUR mit JSON: {\"ok\":true|false,\"issues\":[\"kurz, konkret, auf Deutsch\"]}";

/** Stufe 3: Prüfer-KI. Fehler -> null (gilt als nicht bestanden). */
export async function review(system: string, userMsg: string, body: string, shopId: string): Promise<{ ok: boolean; issues: string[] } | null> {
  try {
    // Gleicher gecachter Anfang wie beim Entwurf (Shop-Richtlinien) -> der Prüfer liest ihn fast gratis aus dem
    // Zwischenspeicher, den der Entwurf Sekunden vorher gefüllt hat. Die Prüfer-Rolle kommt als Zusatz danach.
    const raw = await complete({
      system,
      systemSuffix:
        "\n\n=== ROLLENWECHSEL: DU BIST JETZT DIE PRÜFUNG, NICHT DER VERFASSER ===\n" +
        "Alles oben sind die Richtlinien, nach denen der Entwurf geschrieben wurde. Schreibe KEINE E-Mail und nutze NICHT das Ausgabeformat von oben. " +
        REVIEWER,
      messages: [{ role: "user", content: `ANFRAGE UND DATEN:\n${userMsg}\n\nENTWURF (zu prüfen):\n${body}\n\nAntworte NUR mit dem JSON.` }],
      maxTokens: 2000,
      effort: "low",
      kind: "pruefung",
      shopId,
      cacheTtl: "1h",
    });
    const j = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim()) as { ok?: boolean; issues?: unknown };
    return { ok: j.ok === true, issues: Array.isArray(j.issues) ? j.issues.map(String).slice(0, 6) : [] };
  } catch (e) {
    console.error("[check] Prüfer-Fehler:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Alles prüfen und am Ticket speichern. `body` = Entwurf OHNE Signatur. */
export async function checkDraft(opts: {
  threadId: string;
  shopId: string;
  body: string;
  decision: "auto" | "mensch";
  system: string;
  userMsg: string;
}): Promise<DraftCheck> {
  const t0 = Date.now();
  const facts = factCheck(opts.body, `${opts.userMsg}\n${opts.system}`);
  const [blocks, reviewer] = await Promise.all([
    hardBlocks(opts.threadId, opts.decision),
    review(opts.system, opts.userMsg, opts.body, opts.shopId),
  ]);
  const passed = facts.length === 0 && reviewer?.ok === true;
  const result: DraftCheck = {
    passed,
    facts,
    blocks,
    reviewer,
    autoEligible: passed && blocks.length === 0 && opts.decision === "auto",
    at: new Date().toISOString(),
    ms: Date.now() - t0,
  };
  await db.update(schema.threads).set({ aiCheck: result }).where(eq(schema.threads.id, opts.threadId));
  return result;
}
