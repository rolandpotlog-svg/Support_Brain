// Kennzahlen für die wöchentliche Auswertung (deterministisch, aus der DB).
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/server/db";

export type WeeklyStats = {
  days: number;
  inbound: number;
  replies: number;
  newTickets: number;
  uniqueCustomers: number;
  avgMsgsPerTicket: number;
  avgMsgsPerCustomer: number;
  escalations: number;
  byStatus: { status: string; n: number }[];
  byTag: { tag: string; n: number }[];
  byWeekday: { dow: number; n: number }[];
};

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function weekdayLabel(dow: number): string {
  return WEEKDAYS[dow] ?? String(dow);
}

export async function weeklyStats(shopId: string, days: number): Promise<WeeklyStats> {
  const since = new Date(Date.now() - days * 86_400_000);

  // Nachrichten im Zeitraum (mit Shop-Filter über den Thread).
  const msgRows = await db
    .select({
      direction: schema.messages.direction,
      internal: schema.messages.internal,
      threadId: schema.messages.threadId,
      customerEmail: schema.threads.customerEmail,
      dow: sql<number>`extract(dow from ${schema.messages.createdAt})::int`,
    })
    .from(schema.messages)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.messages.threadId))
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.messages.createdAt, since)));

  const real = msgRows.filter((m) => !m.internal);
  const inboundRows = real.filter((m) => m.direction === "inbound");
  const inbound = inboundRows.length;
  const replies = real.filter((m) => m.direction === "outbound").length;
  const touchedTickets = new Set(real.map((m) => m.threadId)).size;
  const uniqueCustomers = new Set(inboundRows.map((m) => (m.customerEmail || "").toLowerCase())).size;

  const byWeekdayMap = new Map<number, number>();
  for (const m of inboundRows) byWeekdayMap.set(m.dow, (byWeekdayMap.get(m.dow) ?? 0) + 1);
  const byWeekday = [...byWeekdayMap.entries()].map(([dow, n]) => ({ dow, n })).sort((a, b) => a.dow - b.dow);

  // Neue Tickets im Zeitraum + Status-/Tag-Verteilung.
  const newThreads = await db
    .select({ status: schema.threads.status, tag: schema.threads.tag })
    .from(schema.threads)
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.threads.createdAt, since)));

  const statusMap = new Map<string, number>();
  const tagMap = new Map<string, number>();
  for (const t of newThreads) {
    statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1);
    if (t.tag) tagMap.set(t.tag, (tagMap.get(t.tag) ?? 0) + 1);
  }

  const escRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.escalations)
    .innerJoin(schema.threads, eq(schema.threads.id, schema.escalations.threadId))
    .where(and(eq(schema.threads.shopId, shopId), gte(schema.escalations.createdAt, since)));

  return {
    days,
    inbound,
    replies,
    newTickets: newThreads.length,
    uniqueCustomers,
    avgMsgsPerTicket: touchedTickets ? Math.round(((inbound + replies) / touchedTickets) * 10) / 10 : 0,
    avgMsgsPerCustomer: uniqueCustomers ? Math.round((inbound / uniqueCustomers) * 10) / 10 : 0,
    escalations: escRows[0]?.n ?? 0,
    byStatus: [...statusMap.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    byTag: [...tagMap.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n),
    byWeekday,
  };
}
