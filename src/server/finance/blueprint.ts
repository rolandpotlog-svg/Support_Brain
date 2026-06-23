// PnL-Blueprint-Excel parsen (server-only). Spalten-Mapping aus der Vorlage:
// C Umsatz brutto · D Rabatte · E Refunds · G Versand-Einnahme · H USt ·
// J Meta · K Meta2 · L Google · M Taboola · N TikTok · P COGS · Q Versandkosten.
import { createRequire } from "node:module";
import { weekStartOfKw } from "@/lib/finance/week";

const require = createRequire(import.meta.url);
const C = { brutto: 2, rabatte: 3, refunds: 4, versandEinnahme: 6, ust: 7, meta: 9, meta_garten: 10, google: 11, taboola: 12, tiktok: 13, cogs: 15, versand: 16 };
const cents = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : 0);

export type BlueprintWeek = {
  weekStart: string;
  marketing: Record<string, number>;
  umsatzBruttoCents: number;
  rabatteCents: number;
  refundsCents: number;
  versandEinnahmeCents: number;
  ustCents: number;
  cogsCents: number;
  versandkostenCents: number;
  hasRevenue: boolean;
};

export function listSheets(buffer: Buffer): string[] {
  const XLSX = require("xlsx");
  return XLSX.read(buffer, { type: "buffer" }).SheetNames;
}

export function parseBlueprint(buffer: Buffer, sheetName: string): BlueprintWeek[] {
  const XLSX = require("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Tabellenblatt „${sheetName}" nicht gefunden (vorhanden: ${wb.SheetNames.join(", ")})`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });

  const out: BlueprintWeek[] = [];
  for (const r of rows) {
    const kwm = String(r[1] ?? "").match(/^KW(\d+)/);
    if (!kwm) continue;
    const weekStart = weekStartOfKw(Number(kwm[1]));
    const brutto = cents(r[C.brutto]);
    const ust = cents(r[C.ust]);
    out.push({
      weekStart,
      marketing: {
        meta: cents(r[C.meta]),
        meta_garten: cents(r[C.meta_garten]),
        google: cents(r[C.google]),
        taboola: cents(r[C.taboola]),
        tiktok: cents(r[C.tiktok]),
      },
      // Excel "Umsatz brutto" ist EX-USt; +USt speichern, damit der Report (zieht USt ab) korrekt rechnet.
      umsatzBruttoCents: brutto + ust,
      rabatteCents: cents(r[C.rabatte]),
      refundsCents: cents(r[C.refunds]),
      versandEinnahmeCents: cents(r[C.versandEinnahme]),
      ustCents: ust,
      cogsCents: cents(r[C.cogs]),
      versandkostenCents: cents(r[C.versand]),
      hasRevenue: brutto > 0,
    });
  }
  return out;
}
