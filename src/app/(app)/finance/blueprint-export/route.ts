// Download: PnL im Blueprint-Format (Repello-Spalten A–AH + GESAMT + Logik-Tab)
// mit aktuellen Zahlen aus der Engine. Werte (nachvollziehbar), kein Live-Formel-Recalc.
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser, brandAccess } from "@/server/access";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { currentWeekStart } from "@/lib/finance/week";

const require = createRequire(import.meta.url);
const E = (c: number) => Math.round(c) / 100; // Cent -> Euro (Zahl)
const R = (x: number | null) => (x == null ? "" : Math.round(x * 10000) / 10000); // Ratio/ROAS

function dateRange(weekStart: string): string {
  const mon = new Date(`${weekStart}T00:00:00Z`);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const f = (d: Date) => `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return `${f(mon)} - ${f(sun)}`;
}

const HEADERS = [
  "Datum", "KW", "Umsatz brutto (vor Rabatt/Refund)", "Rabatte", "Refunds", "Nettoumsatz",
  "Versand-Einnahme", "USt", "Gesamtumsatz", "Meta", "Meta 2 (Garten-Expert)", "Google", "Taboola", "TikTok",
  "Marketing gesamt", "Produktkosten (COGS)", "Versandkosten", "Payment Fee (4%)", "Fixkosten", "Variable Kosten",
  "Produkt- & sonst. Kosten gesamt", "Refunds %", "ROAS MER (Gesamt)", "ROAS MER (Netto)", "Produktkosten % (Netto)",
  "Kosten Total", "Kosten Total %", "Deckungsbeitrag (vor Fix)", "DB-Marge %", "PnL gesamt", "Marge %",
  "BE-ROAS netto", "BE-ROAS Gesamt", "Ampel",
];

function rowFor(w: WeekRow): (string | number)[] {
  const i = w.inputs, p = w.pnl;
  const brutto = i.umsatzBruttoCents;
  const u = i.produktkostenCents + i.versandkostenCents + p.paymentFeeCents + i.fixkostenCents + i.variableCents;
  return [
    dateRange(w.weekStart), w.label,
    E(brutto), E(i.rabatteCents), E(i.refundsCents), E(p.nettoumsatzCents),
    E(i.versandEinnahmeCents), E(i.ustCents), E(p.gesamtumsatzCents),
    E(w.marketingByChannel.meta ?? 0), E(w.marketingByChannel.meta_garten ?? 0), E(w.marketingByChannel.google ?? 0),
    E(w.marketingByChannel.taboola ?? 0), E(w.marketingByChannel.tiktok ?? 0),
    E(i.marketingCents), E(i.produktkostenCents), E(i.versandkostenCents), E(p.paymentFeeCents),
    E(i.fixkostenCents), E(i.variableCents), E(u),
    R(brutto > 0 ? i.refundsCents / brutto : null), R(p.roasGesamt), R(p.roasNetto),
    R(p.nettoumsatzCents > 0 ? i.produktkostenCents / p.nettoumsatzCents : null),
    E(p.kostenTotalCents), R(p.nettoumsatzCents > 0 ? p.kostenTotalCents / p.nettoumsatzCents : null),
    E(p.deckungsbeitragCents), R(p.nettoumsatzCents > 0 ? p.deckungsbeitragCents / p.nettoumsatzCents : null),
    E(p.pnlCents), R(p.margePct), R(p.beRoasNetto), R(p.beRoasGesamt), p.ampel,
  ];
}

export async function GET(req: Request) {
  let user;
  try { user = await requireUser(); } catch { return new Response("Nicht eingeloggt", { status: 401 }); }
  const shopId = new URL(req.url).searchParams.get("shop") ?? "";
  const caps = shopId ? await brandAccess(user, shopId).catch(() => null) : null;
  if (!caps?.finance) return new Response("Kein Zugriff", { status: 403 });

  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const report = await buildFinanceReport(shopId);
  const cw = currentWeekStart();
  const weeksAsc = [...report.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

  // GESAMT-Zeile: nur vollständige Wochen (wie YTD).
  const complete = weeksAsc.filter((w) => w.weekStart < cw);
  const sum = (f: (w: WeekRow) => number) => complete.reduce((s, w) => s + f(w), 0);
  const gNetto = sum((w) => w.pnl.nettoumsatzCents);
  const gGesamt = sum((w) => w.pnl.gesamtumsatzCents);
  const gMkt = sum((w) => w.inputs.marketingCents);
  const gCogs = sum((w) => w.inputs.produktkostenCents);
  const gKost = sum((w) => w.pnl.kostenTotalCents);
  const gLeist = sum((w) => w.pnl.leistbarCents);
  const gPnl = sum((w) => w.pnl.pnlCents);
  const gDb = sum((w) => w.pnl.deckungsbeitragCents);
  const gesamtRow: (string | number)[] = [
    "GESAMT 2026", shop?.name ?? "",
    E(sum((w) => w.inputs.umsatzBruttoCents)), E(sum((w) => w.inputs.rabatteCents)), E(sum((w) => w.inputs.refundsCents)), E(gNetto),
    E(sum((w) => w.inputs.versandEinnahmeCents)), E(sum((w) => w.inputs.ustCents)), E(gGesamt),
    E(sum((w) => w.marketingByChannel.meta ?? 0)), E(sum((w) => w.marketingByChannel.meta_garten ?? 0)), E(sum((w) => w.marketingByChannel.google ?? 0)),
    E(sum((w) => w.marketingByChannel.taboola ?? 0)), E(sum((w) => w.marketingByChannel.tiktok ?? 0)),
    E(gMkt), E(gCogs), E(sum((w) => w.inputs.versandkostenCents)), E(sum((w) => w.pnl.paymentFeeCents)),
    E(sum((w) => w.inputs.fixkostenCents)), E(sum((w) => w.inputs.variableCents)),
    E(gCogs + sum((w) => w.inputs.versandkostenCents) + sum((w) => w.pnl.paymentFeeCents) + sum((w) => w.inputs.fixkostenCents) + sum((w) => w.inputs.variableCents)),
    "", R(gMkt > 0 ? gGesamt / gMkt : null), R(gMkt > 0 ? gNetto / gMkt : null), R(gNetto > 0 ? gCogs / gNetto : null),
    E(gKost), R(gNetto > 0 ? gKost / gNetto : null), E(gDb), R(gNetto > 0 ? gDb / gNetto : null), E(gPnl), R(gNetto !== 0 ? gPnl / gNetto : null),
    R(gLeist > 0 ? gNetto / gLeist : null), R(gLeist > 0 ? gGesamt / gLeist : null), "",
  ];

  const group = ["2026", shop?.name ?? "", "Umsatz (Shopify)", "", "", "", "", "", "", "Marketing (Ad-Accounts)", "", "", "", "", "", "Produkt- & sonst. Kosten", "", "", "", "", "", "Kennzahlen", "", "", "", "", "", "", "", "Ergebnis"];
  const repAoa: (string | number)[][] = [group, HEADERS, gesamtRow, ...weeksAsc.map(rowFor)];

  const logik = [
    ["PnL — Support-Brain Export"], ["Stand", new Date().toLocaleString("de-DE")], [],
    ["Eine Zeile = eine Kalenderwoche (Mo–So). Oben die GESAMT-Summe (nur abgeschlossene Wochen)."],
    ["Nettoumsatz = Brutto − Rabatte − Refunds. Gesamtumsatz = Netto + Versand-Einnahme + USt (Triple-Whale-Basis)."],
    ["Payment Fee = 4 % vom Gesamtumsatz. Ampel gegen BE-ROAS Gesamt (rot < BE, grün ≥ BE × 1,15)."],
    ["Marketing: Meta/Google automatisch; Versand: Pickoship; COGS: Menge × Stückkost; Fix/Var: manuell."],
    ["Hinweis: Werte aus dem Tool (eine Quelle der Wahrheit). Historische Wochen aus dem Blueprint, aktuelle live."],
  ];

  const XLSX = require("xlsx");
  const wb = XLSX.utils.book_new();
  const wsLogik = XLSX.utils.aoa_to_sheet(logik);
  wsLogik["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsLogik, "Logik & Anleitung");
  const wsRep = XLSX.utils.aoa_to_sheet(repAoa);
  wsRep["!cols"] = HEADERS.map((h, i) => ({ wch: i < 2 ? 22 : Math.max(10, Math.min(16, h.length)) }));
  wsRep["!freeze"] = { xSplit: 2, ySplit: 2 };
  XLSX.utils.book_append_sheet(wb, wsRep, shop?.name ?? "Repello");

  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fname = `PnL_${(shop?.name ?? "Shop").replace(/[^\w]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
