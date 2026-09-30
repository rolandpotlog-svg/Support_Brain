// KI-Entwurf für einen PayPal-Fall: Empfehlung + Nachricht an den Käufer + (nur wenn nötig) Stellungnahme an PayPal.
// Wird vom Button auf der Fallseite UND automatisch vom Worker für neue offene Fälle aufgerufen.
// Grundsatz: PayPal-Score schützen — kulant lösen statt Fälle verlieren; kämpfen nur mit klarem Beleg.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { complete } from "@/server/ai";
import { HUMAN_VOICE } from "@/server/ai/draft-prompt";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getOrderByName } from "@/lib/shopify/client";
import { bestBodyText } from "@/lib/mailbox/html-text";
import { reasonInfo } from "@/lib/disputes/reasons";
import { factsFromOrder, paypalAdvice, stageLabel, KULANZ_EUR, ADVICE_LABEL, type CaseFacts } from "@/lib/disputes/paypal-policy";

export type PaypalDraft = { advice: string; buyerMessage: string; statement: string; evidence: string };

/** Antwort der KI in die vier Abschnitte zerlegen (fehlende Abschnitte = leer). */
export function parsePaypalDraft(text: string): PaypalDraft {
  const grab = (tag: string) => {
    const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    return (m?.[1] ?? "").trim();
  };
  return { advice: grab("empfehlung"), buyerMessage: grab("nachricht_kaeufer"), statement: grab("stellungnahme"), evidence: grab("belege") };
}

function factsText(f: CaseFacts | null): string {
  if (!f) return "Keine Bestellung sicher zugeordnet — keine Shop-Daten.";
  const tr = f.tracking.map((t) => [t.company, t.number, t.url].filter(Boolean).join(" ")).join(" | ");
  return [
    `Bestelldatum: ${f.orderDate ? new Date(f.orderDate).toLocaleDateString("de-DE") : "?"} · Betrag: ${f.total ?? "?"} · Zahlung: ${f.financialStatus ?? "?"}`,
    `Artikel: ${f.items.join(", ") || "?"}${f.personalized ? " (personalisiert/graviert)" : ""}`,
    `Versand: ${f.fulfillment ?? "?"} · Sendungsstatus: ${f.delivery ?? "unbekannt"}${f.deliveredAt ? ` am ${new Date(f.deliveredAt).toLocaleDateString("de-DE")}` : ""}`,
    `Tracking: ${tr || "keins"}`,
    `Lieferadresse: ${f.shipTo ?? "?"}`,
  ].join("\n");
}

export async function buildPaypalDraft(caseId: string, userId: string | null): Promise<PaypalDraft> {
  const c = await db.query.disputeCase.findFirst({ where: eq(schema.disputeCase.id, caseId) });
  if (!c) throw new Error("Fall nicht gefunden");
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, c.shopId) });

  // Shop-Daten frisch abgleichen (Zustellstatus ändert sich)
  let facts = (c.facts as CaseFacts | null) ?? null;
  if (c.orderName) {
    const creds = await loadShopifyCreds(c.shopId);
    const hit = creds ? await getOrderByName(creds, c.orderName).catch(() => null) : null;
    if (hit) facts = factsFromOrder(hit.order);
  }
  const advice = paypalAdvice({ amount: c.amount, reason: c.reason, stage: c.type, matchConfidence: c.matchConfidence, facts });

  // Kundenkommunikation (Support-Ticket)
  let comms = "Kein Support-Ticket zugeordnet.";
  if (c.threadId) {
    const msgs = await db
      .select({ direction: schema.messages.direction, internal: schema.messages.internal, bodyText: schema.messages.bodyText, bodyHtml: schema.messages.bodyHtml, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(eq(schema.messages.threadId, c.threadId))
      .orderBy(schema.messages.createdAt);
    comms =
      msgs
        .filter((m) => !m.internal)
        .slice(-12)
        .map((m) => `${m.createdAt.toLocaleDateString("de-DE")} ${m.direction === "inbound" ? "Kunde" : "Wir"}: ${(bestBodyText(m.bodyText, m.bodyHtml) ?? "").replace(/\s+/g, " ").slice(0, 600)}`)
        .join("\n") || comms;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = c.raw ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ppMsgs = (raw.messages ?? []).map((m: any) => `${m.posted_by === "SELLER" ? "Wir" : m.posted_by === "BUYER" ? "Käufer" : m.posted_by}: ${m.content}`).join("\n") || "keine";
  const profile = await db.query.shopProfile.findFirst({ where: eq(schema.shopProfile.shopId, c.shopId) });
  const p = profile?.data;
  const rules = p ? [p.notReturnable, p.returnPeriod, p.exchange, p.shipping, p.damage, p.refund].filter(Boolean).join("\n") : "";
  const du = p?.address === "du";
  const signature = p?.signature?.trim() || `Ihr ${shop?.name ?? ""}-Team`;

  const system =
    `Du bearbeitest für den Online-Shop „${shop?.name ?? ""}“ einen PayPal-Käuferschutzfall. Oberstes Ziel: den PayPal-Verkäufer-Score schützen. ` +
    "Jeder verlorene Fall schadet dem Konto, deshalb gilt: lieber kulant und schnell lösen als diskutieren. Verteidigen (kämpfen) nur, wenn die Bestellung sicher zugeordnet und die Zustellung bzw. Erstattung klar belegt ist. " +
    `Unter ${KULANZ_EUR} € im Zweifel erstatten. In der Phase „Anfrage“ den Fall direkt mit dem Käufer lösen, damit er nicht zum Konflikt eskaliert. ` +
    "Nur Fakten aus den Daten verwenden, nichts erfinden (keine Daten, Nummern oder Zusagen, die nicht belegt sind). Links: ausschließlich der Tracking-Link aus den Shop-Daten, keine anderen URLs. " +
    "Bei personalisierter/gravierter Ware darf auf den gesetzlichen Ausschluss vom Widerrufsrecht hingewiesen werden, aber NICHT bei „nicht erhalten“ oder Mängeln (Gewährleistung gilt immer).\n\n" +
    "Gib GENAU diese vier Abschnitte aus:\n" +
    "<empfehlung>Eine Zeile fürs Team: „Mit Käufer lösen“, „Kulant erstatten“ oder „Mit Beleg verteidigen“ + kurzer Grund + konkreter nächster Schritt (z. B. Erstattung 39,95 € in PayPal auslösen).</empfehlung>\n" +
    `<nachricht_kaeufer>Die Nachricht an den Käufer im PayPal-Fall. ${du ? "Per du." : "Immer per Sie."} Freundlich, menschlich, lösungsorientiert, kurz. Konkretes Angebot (Sendungsverfolgung mit Zustelldatum, Ersatz, Erstattung) passend zur Empfehlung. Keine Vorwürfe. Endet mit „${signature}“.</nachricht_kaeufer>\n` +
    "<stellungnahme>Nur bei „Mit Beleg verteidigen“: sachliche, chronologische Stellungnahme an PayPal (Bestellung, Versand/Zustellung, Kommunikation, warum der Anspruch nicht berechtigt ist). Sonst leer lassen.</stellungnahme>\n" +
    "<belege>Liste der Belege zum Anhängen (nur bei Verteidigung), sonst leer.</belege>" +
    HUMAN_VOICE;

  const text = await complete({
    system,
    messages: [
      {
        role: "user",
        content: [
          `FALL: PayPal · Phase: ${stageLabel(c.type)} · Grund: ${c.reasonCode ?? c.reason} (${reasonInfo(c.reason).label}) · Betrag ${c.amount ?? "?"} ${c.currency ?? ""}`,
          `Frist: ${c.dueBy ? c.dueBy.toLocaleDateString("de-DE") : "?"}`,
          `Käufer: ${c.customerName ?? "?"} <${c.customerEmail ?? "?"}>`,
          `Zuordnung zur Bestellung ${c.orderName ?? ""}: ${c.matchConfidence ?? "?"} (${c.matchNote ?? ""})`,
          `Regel-Empfehlung des Systems: ${ADVICE_LABEL[advice.action]} — ${advice.why}`,
          "",
          "PAYPAL-NACHRICHTEN:",
          ppMsgs,
          "",
          "SHOP-DATEN (Shopify):",
          factsText(facts),
          "",
          "SUPPORT-MAILS MIT DEM KUNDEN:",
          comms,
          "",
          "SHOP-REGELN:",
          rules || "(keine)",
        ].join("\n"),
      },
    ],
    maxTokens: 6000,
    effort: "medium",
    kind: "dispute",
    shopId: c.shopId,
  });
  const d = parsePaypalDraft(text);
  if (!d.buyerMessage && !d.statement) throw new Error("KI-Antwort unvollständig — bitte neu entwerfen.");

  const evidence = {
    ...(c.evidence ?? {}),
    paypalAdvice: d.advice,
    paypalBuyerMessage: d.buyerMessage,
    paypalResponse: d.statement,
    paypalEvidence: d.evidence,
  };
  await db.update(schema.disputeCase).set({ evidence, facts, updatedAt: new Date() }).where(eq(schema.disputeCase.id, caseId));
  await db.insert(schema.disputeAudit).values({ caseId, userId, action: "evidence_assembled", detail: userId ? "KI-Entwurf (PayPal) erstellt" : "KI-Entwurf (PayPal) automatisch erstellt" });
  return d;
}

/** Worker: neue offene PayPal-Fälle ohne Entwurf automatisch vorbereiten (max. 5 pro Durchlauf). */
export async function autoDraftPaypal(): Promise<number> {
  const rows = await db
    .select({ id: schema.disputeCase.id })
    .from(schema.disputeCase)
    .where(
      and(
        eq(schema.disputeCase.source, "paypal"),
        eq(schema.disputeCase.status, "NEEDS_RESPONSE"),
        sql`coalesce(${schema.disputeCase.evidence}->>'paypalBuyerMessage', '') = ''`,
        sql`coalesce(${schema.disputeCase.evidence}->>'paypalResponse', '') = ''`,
        // fehlgeschlagene Versuche frühestens nach 6 h wiederholen (keine Dauer-Kosten)
        sql`coalesce((${schema.disputeCase.evidence}->>'paypalDraftFailedAt')::timestamptz, 'epoch') < now() - interval '6 hours'`,
      ),
    )
    .limit(5);
  let n = 0;
  for (const r of rows) {
    try {
      await buildPaypalDraft(r.id, null);
      n++;
    } catch (e) {
      console.error(`[paypal] Entwurf ${r.id}:`, e instanceof Error ? e.message : e);
      await db
        .update(schema.disputeCase)
        .set({ evidence: sql`coalesce(${schema.disputeCase.evidence}, '{}'::jsonb) || jsonb_build_object('paypalDraftFailedAt', now()::text)` })
        .where(eq(schema.disputeCase.id, r.id));
    }
  }
  return n;
}
