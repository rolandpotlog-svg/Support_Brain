// Baut den Daten-Kontext für den Finance-Assistenten: echte, berechnete Zahlen
// aus der Engine als Text. Die KI darf NUR daraus antworten (Grounding).
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { buildFinanceReport } from "@/server/finance/report";
import { getCogsRateRows, getProductBreakdown } from "@/server/finance/cogs-rates";
import { currentWeekStart } from "@/lib/finance/week";

const e = (c: number) => (c / 100).toFixed(2);
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const roas = (x: number | null) => (x == null ? "—" : x.toFixed(2));

export async function buildAssistantContext(shopId: string): Promise<string> {
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) });
  const report = await buildFinanceReport(shopId);
  const rates = await getCogsRateRows(shopId);
  const cw = currentWeekStart();

  const lines: string[] = [];
  lines.push(`MARKE: ${shop?.name ?? "?"}`);
  lines.push(`Heutige Woche (läuft, vorläufig): ${cw}`);
  lines.push("");
  lines.push("YTD (nur abgeschlossene Wochen):");
  const y = report.ytd;
  lines.push(`  Nettoumsatz ${e(y.nettoumsatzCents)} € · Marketing ${e(y.marketingCents)} € · COGS ${e(y.cogsCents)} € · Versand ${e(y.versandkostenCents)} € · PaymentFee ${e(y.paymentFeeCents)} € · PnL ${e(y.pnlCents)} € · Marge ${pct(y.margePct)} · ROAS ${roas(y.roasGesamt)} · BE-ROAS ${roas(y.beRoasGesamt)}`);
  lines.push("");

  lines.push("STÜCKKOSTEN (COGS-Basis, je Stück):");
  for (const r of rates) lines.push(`  ${r.label}: ${e(r.unitCents)} € (${r.isDefault ? "Standard" : "angepasst"}) — ${r.hint}`);
  lines.push("");

  lines.push("WOCHEN (älteste zuerst). Felder: KW | Status | Netto | Brutto | Rabatte | Refunds | Marketing(Meta/Garten/Google/Taboola/TikTok) | COGS (COGS% v.Netto) | Versand (Versand%) | Fee | Fix | Var | DB(vor Werbung) | PnL | ROAS | BE-ROAS | Ampel | Orders | OhneVersand | UnbekanntesProdukt");
  const weeksAsc = [...report.weeks].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  for (const w of weeksAsc) {
    const i = w.inputs, p = w.pnl, mk = w.marketingByChannel;
    const status = w.weekStart >= cw ? "läuft" : "abgeschlossen";
    const cogsPct = p.nettoumsatzCents > 0 ? i.produktkostenCents / p.nettoumsatzCents : null;
    const versPct = p.nettoumsatzCents > 0 ? i.versandkostenCents / p.nettoumsatzCents : null;
    lines.push(
      `  ${w.label} | ${status} | ${e(p.nettoumsatzCents)} | ${e(i.umsatzBruttoCents)} | ${e(i.rabatteCents)} | ${e(i.refundsCents)}` +
      ` | M${e(mk.meta ?? 0)}/G${e(mk.meta_garten ?? 0)}/Go${e(mk.google ?? 0)}/Ta${e(mk.taboola ?? 0)}/Ti${e(mk.tiktok ?? 0)} (Σ${e(i.marketingCents)})` +
      ` | COGS ${e(i.produktkostenCents)} (${pct(cogsPct)}) | Vers ${e(i.versandkostenCents)} (${pct(versPct)}) | Fee ${e(p.paymentFeeCents)} | Fix ${e(i.fixkostenCents)} | Var ${e(i.variableCents)}` +
      ` | DB ${e(p.deckungsbeitragCents)} | PnL ${e(p.pnlCents)} | ROAS ${roas(p.roasGesamt)} | BE ${roas(p.beRoasGesamt)} | ${p.ampel} | Orders ${w.orderCount} | OhneVersand ${w.shippingPending} | UnbekProd ${w.unmappedOrders}`,
    );
  }
  lines.push("");

  // Produkt-Aufschlüsselung (COGS je Produkt) für Wochen mit Shopify-Orders — wichtig für COGS-Fragen.
  lines.push("PRODUKT-AUFSCHLÜSSELUNG je Woche (nur Wochen mit Shopify-Bestellungen): Produkt = Menge × berechnete COGS");
  for (const w of weeksAsc) {
    if (w.orderCount === 0) continue;
    const bd = await getProductBreakdown(shopId, w.weekStart);
    if (bd.length === 0) continue;
    lines.push(`  ${w.label}: ` + bd.map((b) => `${b.label} ${b.units}×=${e(b.cogsCents)}€`).join(" · "));
  }

  return lines.join("\n");
}
