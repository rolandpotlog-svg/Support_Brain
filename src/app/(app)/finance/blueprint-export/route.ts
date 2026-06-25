// Download: PnL im Blueprint-Format (Repello-Spalten A–AH + GESAMT + Logik-Tab)
// mit aktuellen Zahlen aus der Engine — formatiert (ExcelJS): €/%-Formate, fette
// Header, blaue Input-Spalten, farbige Ampel, Rahmen, fixierte Kopfzeilen.
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser, brandAccess } from "@/server/access";
import { buildFinanceReport, type WeekRow } from "@/server/finance/report";
import { currentWeekStart } from "@/lib/finance/week";

const require = createRequire(import.meta.url);
const E = (c: number) => Math.round(c) / 100;
const R = (x: number | null): number | string => (x == null ? "" : Math.round(x * 10000) / 10000);

function dateRange(weekStart: string): string {
  const mon = new Date(`${weekStart}T00:00:00Z`);
  const sun = new Date(mon.getTime() + 6 * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  const f = (d: Date) => `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return `${f(mon)} - ${f(sun)}`;
}

const HEADERS = [
  "Datum", "KW", "Umsatz brutto", "Rabatte", "Refunds", "Nettoumsatz",
  "Versand-Einnahme", "USt", "Gesamtumsatz", "Meta", "Meta 2 (Garten)", "Google", "Taboola", "TikTok",
  "Marketing gesamt", "Produktkosten (COGS)", "Versandkosten", "Payment Fee (4%)", "Fixkosten", "Variable Kosten",
  "Produkt-/sonst. Kosten", "Refunds %", "ROAS (Gesamt)", "ROAS (Netto)", "COGS % (Netto)",
  "Kosten Total", "Kosten Total %", "Deckungsbeitrag", "DB-Marge %", "PnL gesamt", "Marge %",
  "BE-ROAS netto", "BE-ROAS Gesamt", "Ampel",
];

// Spaltentypen (1-basiert).
const EURO = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 26, 28, 30];
const PERCENT = [22, 25, 27, 29, 31];
const RATIO = [23, 24, 32, 33];
const INPUT = [3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 16, 17, 19, 20];
const AMPEL_ARGB: Record<string, string> = { rot: "FFE5634D", gelb: "FFD9A300", gruen: "FF3FB950", neutral: "FFBFC4CC" };

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
  const shopName = shop?.name ?? "Repello";
  const report = await buildFinanceReport(shopId);
  const cw = currentWeekStart();
  const weeksAsc = [...report.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));

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
  const gVers = sum((w) => w.inputs.versandkostenCents);
  const gFee = sum((w) => w.pnl.paymentFeeCents);
  const gFix = sum((w) => w.inputs.fixkostenCents);
  const gVar = sum((w) => w.inputs.variableCents);
  const gesamtRow: (string | number)[] = [
    "GESAMT 2026", shopName,
    E(sum((w) => w.inputs.umsatzBruttoCents)), E(sum((w) => w.inputs.rabatteCents)), E(sum((w) => w.inputs.refundsCents)), E(gNetto),
    E(sum((w) => w.inputs.versandEinnahmeCents)), E(sum((w) => w.inputs.ustCents)), E(gGesamt),
    E(sum((w) => w.marketingByChannel.meta ?? 0)), E(sum((w) => w.marketingByChannel.meta_garten ?? 0)), E(sum((w) => w.marketingByChannel.google ?? 0)),
    E(sum((w) => w.marketingByChannel.taboola ?? 0)), E(sum((w) => w.marketingByChannel.tiktok ?? 0)),
    E(gMkt), E(gCogs), E(gVers), E(gFee), E(gFix), E(gVar), E(gCogs + gVers + gFee + gFix + gVar),
    "", R(gMkt > 0 ? gGesamt / gMkt : null), R(gMkt > 0 ? gNetto / gMkt : null), R(gNetto > 0 ? gCogs / gNetto : null),
    E(gKost), R(gNetto > 0 ? gKost / gNetto : null), E(gDb), R(gNetto > 0 ? gDb / gNetto : null), E(gPnl), R(gNetto !== 0 ? gPnl / gNetto : null),
    R(gLeist > 0 ? gNetto / gLeist : null), R(gLeist > 0 ? gGesamt / gLeist : null), "",
  ];
  const group = ["2026", shopName, "Umsatz (Shopify)", "", "", "", "", "", "", "Marketing (Ad-Accounts)", "", "", "", "", "", "Produkt- & sonst. Kosten", "", "", "", "", "", "Kennzahlen", "", "", "", "", "", "", "", "Ergebnis"];

  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();

  // Logik-Tab
  const wl = wb.addWorksheet("Logik & Anleitung");
  wl.getColumn(1).width = 115;
  [
    ["PnL — Support-Brain Export"], [`Stand: ${new Date().toLocaleString("de-DE")}`], [],
    ["Eine Zeile = eine Kalenderwoche (Mo–So). Oben die GESAMT-Summe (nur abgeschlossene Wochen)."],
    ["Nettoumsatz = Brutto − Rabatte − Refunds. Gesamtumsatz = Netto + Versand-Einnahme + USt (Triple-Whale-Basis)."],
    ["Payment Fee = 4 % vom Gesamtumsatz. Ampel gegen BE-ROAS Gesamt (rot < BE, grün ≥ BE × 1,15)."],
    ["BLAU hinterlegte Spalten = Eingangswerte (Shopify/Ads/Stückkosten/manuell). Übrige = berechnet."],
    ["Marketing: Meta/Google automatisch · Versand: Pickoship · COGS: Menge × Stückkost · Fix/Var: manuell."],
  ].forEach((r) => wl.addRow(r));
  wl.getRow(1).font = { bold: true, size: 14 };

  // Repello-Tab
  const ws = wb.addWorksheet(shopName, { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  ws.addRow(group);
  ws.addRow(HEADERS);
  ws.addRow(gesamtRow);
  weeksAsc.forEach((w) => ws.addRow(rowFor(w)));
  const lastRow = ws.rowCount;

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 8;
  for (let c = 3; c <= 34; c++) ws.getColumn(c).width = 13;
  EURO.forEach((c) => (ws.getColumn(c).numFmt = '#,##0.00\\ €'));
  PERCENT.forEach((c) => (ws.getColumn(c).numFmt = "0.0%"));
  RATIO.forEach((c) => (ws.getColumn(c).numFmt = "0.00"));

  // Kopfzeilen (1+2): dunkel, weiß, fett, umgebrochen
  for (const r of [1, 2]) {
    const row = ws.getRow(r);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = r === 2 ? 32 : 18;
    for (let c = 1; c <= 34; c++) row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A44" } };
  }
  // GESAMT-Zeile (3): grau, fett
  const g3 = ws.getRow(3);
  g3.font = { bold: true };
  for (let c = 1; c <= 34; c++) g3.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };

  // Input-Spalten blau (nur Wochenzeilen 4..lastRow)
  for (let r = 4; r <= lastRow; r++) {
    for (const c of INPUT) ws.getRow(r).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1FF" } };
    // Ampel-Zelle farbig
    const cell = ws.getRow(r).getCell(34);
    const argb = AMPEL_ARGB[String(cell.value ?? "")];
    if (argb) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center" };
    }
  }

  // dünne Rahmen über die ganze Tabelle
  const thin = { style: "thin" as const, color: { argb: "FFD8DCE3" } };
  for (let r = 1; r <= lastRow; r++) for (let c = 1; c <= 34; c++) ws.getRow(r).getCell(c).border = { top: thin, left: thin, bottom: thin, right: thin };

  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const fname = `PnL_${shopName.replace(/[^\w]+/g, "_")}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
      "Cache-Control": "no-store",
    },
  });
}
