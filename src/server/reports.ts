// Umfassende Kennzahlen für die Auswertung (deterministisch aus der DB).
// KI-Klassifizierung (aiCategory/aiSentiment/aiProduct) wird separat befüllt und hier nur aggregiert.
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { CATEGORY_AREA, normalizeCategory } from "@/lib/reports/categories";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function weekdayLabel(dow: number): string {
  return WEEKDAYS[dow] ?? String(dow);
}

export type FullReport = {
  days: number;
  // Volumen & Last
  inbound: number;
  inboundPrev: number;
  replies: number;
  newTickets: number;
  newTicketsPrev: number;
  reopened: number;
  uniqueCustomers: number;
  avgMsgsPerTicket: number;
  avgMsgsPerCustomer: number;
  escalations: number;
  escalationsPrev: number;
  byWeekday: { dow: number; n: number }[];
  byHour: { hour: number; n: number }[];
  byStatus: { status: string; n: number }[];
  byTag: { tag: string; n: number }[];
  // Themen
  classifiedCount: number;
  unclassifiedCount: number;
  byCategory: { category: string; n: number; prev: number }[];
  byProduct: { product: string; n: number }[];
  // Effizienz
  avgFirstResponseMin: number | null;
  avgResolutionHours: number | null;
  fcrRate: number | null;
  backlogAging: number;
  // KI-Qualität
  draftOutcomes: { verbatim: number; edited: number; manual: number };
  // Sentiment
  sentiment: { positiv: number; neutral: number; negativ: number };
  // Retouren-Portal
  returns: {
    total: number;
    deflected: number;
    recoveredCents: number;
    defectClaims: number;
    byOutcome: { outcome: string; n: number }[];
  };
  // Frühwarnung
  warnings: { title: string; detail: string }[];
};

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export async function fullReport(shopId: string, days: number): Promise<FullReport> {
  const now = Date.now();
  const curStart = new Date(now - days * 86_400_000);
  const prevStart = new Date(now - 2 * days * 86_400_000);

  // 1) Nachrichten der letzten 2 Perioden (für Trend).
  const msgRows = await db
    .select({
      direction: schema.messages.direction,
      internal: schema.messages.internal,
      threadId: schema.messages.threadId,
      threadCreatedAt: schema.threads.createdAt,
      createdAt: schema.messages.createdAt,
      email: schema.threads.customerEmail,
    })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.messages.createdAt, prevStart)));

  const real = msgRows.filter((m) => !m.internal);
  const isCur = (d: Date) => d >= curStart;
  const inboundAll = real.filter((m) => m.direction === "inbound");
  const inboundCur = inboundAll.filter((m) => isCur(m.createdAt));
  const inbound = inboundCur.length;
  const inboundPrev = inboundAll.length - inbound;
  const replies = real.filter((m) => m.direction === "outbound" && isCur(m.createdAt)).length;

  const byWeekdayMap = new Map<number, number>();
  const byHourMap = new Map<number, number>();
  for (const m of inboundCur) {
    const d = m.createdAt;
    byWeekdayMap.set(d.getDay(), (byWeekdayMap.get(d.getDay()) ?? 0) + 1);
    byHourMap.set(d.getHours(), (byHourMap.get(d.getHours()) ?? 0) + 1);
  }
  const byWeekday = [...byWeekdayMap.entries()].map(([dow, n]) => ({ dow, n })).sort((a, b) => a.dow - b.dow);
  const byHour = [...byHourMap.entries()].map(([hour, n]) => ({ hour, n })).sort((a, b) => a.hour - b.hour);

  const uniqueCustomers = new Set(inboundCur.map((m) => (m.email || "").toLowerCase())).size;
  const touchedTickets = new Set(real.filter((m) => isCur(m.createdAt)).map((m) => m.threadId)).size;

  // Wieder-aufgemacht: eingehende Mail in der Periode für ein Ticket, das VOR der Periode angelegt wurde.
  const reopened = new Set(inboundCur.filter((m) => m.threadCreatedAt < curStart).map((m) => m.threadId)).size;

  // Nachrichtenzahlen je aktuellem Ticket (für FCR).
  const perTicket = new Map<string, { in: number; out: number }>();
  for (const m of real) {
    if (m.threadCreatedAt < curStart) continue;
    const e = perTicket.get(m.threadId) ?? { in: 0, out: 0 };
    if (m.direction === "inbound") e.in++;
    else e.out++;
    perTicket.set(m.threadId, e);
  }

  // 2) Tickets der letzten 2 Perioden.
  const threadRows = await db
    .select({
      id: schema.threads.id,
      createdAt: schema.threads.createdAt,
      status: schema.threads.status,
      tag: schema.threads.tag,
      aiCategory: schema.threads.aiCategory,
      aiSentiment: schema.threads.aiSentiment,
      aiProduct: schema.threads.aiProduct,
      aiClassifiedAt: schema.threads.aiClassifiedAt,
      firstResponseAt: schema.threads.firstResponseAt,
      closedAt: schema.threads.closedAt,
    })
    .from(schema.threads)
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.threads.createdAt, prevStart)));

  const curThreads = threadRows.filter((t) => isCur(t.createdAt));
  const prevThreads = threadRows.filter((t) => !isCur(t.createdAt));
  const newTickets = curThreads.length;
  const newTicketsPrev = prevThreads.length;

  const statusMap = new Map<string, number>();
  const tagMap = new Map<string, number>();
  const catCur = new Map<string, number>();
  const catPrev = new Map<string, number>();
  const productMap = new Map<string, number>();
  const sentiment = { positiv: 0, neutral: 0, negativ: 0 };
  let classifiedCount = 0;
  const respMins: number[] = [];
  const resHours: number[] = [];
  let closedCur = 0;
  let fcrCount = 0;

  for (const t of curThreads) {
    statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1);
    if (t.tag) tagMap.set(t.tag, (tagMap.get(t.tag) ?? 0) + 1);
    if (t.aiClassifiedAt) {
      classifiedCount++;
      const c = normalizeCategory(t.aiCategory);
      catCur.set(c, (catCur.get(c) ?? 0) + 1);
      if (t.aiProduct) productMap.set(t.aiProduct, (productMap.get(t.aiProduct) ?? 0) + 1);
      const s = t.aiSentiment as keyof typeof sentiment;
      if (s in sentiment) sentiment[s]++;
    }
    if (t.firstResponseAt) respMins.push((t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000);
    if (t.closedAt) {
      resHours.push((t.closedAt.getTime() - t.createdAt.getTime()) / 3_600_000);
      closedCur++;
      const pt = perTicket.get(t.id);
      if (pt && pt.in <= 1 && pt.out === 1) fcrCount++;
    }
  }
  for (const t of prevThreads) {
    if (t.aiClassifiedAt) {
      const c = normalizeCategory(t.aiCategory);
      catPrev.set(c, (catPrev.get(c) ?? 0) + 1);
    }
  }

  const byCategory = [...catCur.entries()]
    .map(([category, n]) => ({ category, n, prev: catPrev.get(category) ?? 0 }))
    .sort((a, b) => b.n - a.n);
  const byProduct = [...productMap.entries()].map(([product, n]) => ({ product, n })).sort((a, b) => b.n - a.n);

  // 3) Eskalationen (Trend).
  const escRows = await db
    .select({ createdAt: schema.escalations.createdAt })
    .from(schema.escalations)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.escalations.threadId))
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.escalations.createdAt, prevStart)));
  const escalations = escRows.filter((e) => isCur(e.createdAt)).length;
  const escalationsPrev = escRows.length - escalations;

  // 4) Rückstau: offene Tickets älter als 48 h.
  const backlogRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        inArray(schema.threads.status, ["open", "pending", "escalated"]),
        lt(schema.threads.createdAt, new Date(now - 48 * 3_600_000)),
      ),
    );
  const backlogAging = backlogRows[0]?.n ?? 0;

  // 5) KI-Entwurf-Nutzung in der Periode.
  const draftRows = await db
    .select({ outcome: schema.messages.aiOutcome })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        eq(schema.messages.direction, "outbound"),
        gte(schema.messages.createdAt, curStart),
      ),
    );
  const draftOutcomes = { verbatim: 0, edited: 0, manual: 0 };
  for (const d of draftRows) {
    if (d.outcome === "verbatim") draftOutcomes.verbatim++;
    else if (d.outcome === "edited") draftOutcomes.edited++;
    else draftOutcomes.manual++;
  }

  // 6) Retouren-Portal (Fälle im Zeitraum).
  const retRows = await db
    .select({
      outcome: schema.returnCases.outcome,
      recovered: schema.returnCases.recoveredValueCents,
      routing: schema.returnCases.reasonRouting,
    })
    .from(schema.returnCases)
    .where(and(eq(schema.returnCases.shopId, shopId), gte(schema.returnCases.createdAt, curStart)));
  const outcomeMap = new Map<string, number>();
  let recoveredCents = 0;
  let deflected = 0;
  let defectClaims = 0;
  for (const r of retRows) {
    const o = r.outcome ?? "?";
    outcomeMap.set(o, (outcomeMap.get(o) ?? 0) + 1);
    recoveredCents += r.recovered ?? 0;
    if (o === "deflected_keep") deflected++;
    if (r.routing === "defect_photo") defectClaims++;
  }
  const returns = {
    total: retRows.length,
    deflected,
    recoveredCents,
    defectClaims,
    byOutcome: [...outcomeMap.entries()].map(([outcome, n]) => ({ outcome, n })).sort((a, b) => b.n - a.n),
  };

  // 7) Frühwarnungen (regelbasiert: Kategorien-Trends + Produkt-Hotspot + Sentiment + Rückstau).
  const warnings: { title: string; detail: string }[] = [];
  for (const c of byCategory) {
    const area = CATEGORY_AREA[c.category as keyof typeof CATEGORY_AREA];
    if (!area || c.n < 3) continue;
    const rising = c.prev === 0 ? c.n >= 3 : c.n >= c.prev * 1.5;
    if (rising) {
      warnings.push({
        title: `${c.category} steigt (${c.prev} → ${c.n})`,
        detail: `Mögliche Ursache an der Quelle: ${area}.`,
      });
    }
  }
  if (byProduct[0] && byProduct[0].n >= 3) {
    warnings.push({
      title: `Produkt-Hotspot: ${byProduct[0].product} (${byProduct[0].n} Beschwerden)`,
      detail: "Häufung bei einem Produkt → Lieferant/Qualität prüfen.",
    });
  }
  const sentTotal = sentiment.positiv + sentiment.neutral + sentiment.negativ;
  if (sentTotal >= 5 && sentiment.negativ / sentTotal > 0.4) {
    warnings.push({
      title: `Stimmung kippt: ${Math.round((sentiment.negativ / sentTotal) * 100)} % negativ`,
      detail: "Anteil negativer Anfragen hoch → Ursachen priorisiert angehen.",
    });
  }
  if (backlogAging > 0) {
    warnings.push({
      title: `${backlogAging} offene Tickets älter als 48 h`,
      detail: "Rückstau — Bearbeitung/Besetzung prüfen (z. B. Wochenende).",
    });
  }
  if (returns.defectClaims >= 3) {
    warnings.push({
      title: `${returns.defectClaims} Defekt-Reklamationen (Retouren)`,
      detail: "Beim Lieferanten bündeln — Qualität/Charge prüfen.",
    });
  }

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    days,
    inbound,
    inboundPrev,
    replies,
    newTickets,
    newTicketsPrev,
    reopened,
    uniqueCustomers,
    avgMsgsPerTicket: touchedTickets ? r1((inbound + replies) / touchedTickets) : 0,
    avgMsgsPerCustomer: uniqueCustomers ? r1(inbound / uniqueCustomers) : 0,
    escalations,
    escalationsPrev,
    byWeekday,
    byHour,
    byStatus: [...statusMap.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    byTag: [...tagMap.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
    classifiedCount,
    unclassifiedCount: newTickets - classifiedCount,
    byCategory,
    byProduct,
    avgFirstResponseMin: respMins.length ? r1(avg(respMins)) : null,
    avgResolutionHours: resHours.length ? r1(avg(resHours)) : null,
    fcrRate: closedCur ? fcrCount / closedCur : null,
    backlogAging,
    draftOutcomes,
    sentiment,
    returns,
    warnings,
  };
}

/** Wie viele Tickets im Zeitraum sind noch nicht KI-klassifiziert? (für den Button-Hinweis) */
export async function unclassifiedInPeriod(shopId: string, days: number): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.threads)
    .where(
      and(
        eq(schema.threads.shopId, shopId),
        gte(schema.threads.createdAt, since),
        isNull(schema.threads.aiClassifiedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}
