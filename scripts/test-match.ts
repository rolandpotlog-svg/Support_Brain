// Schnelltest der reinen Abgleich-Logik (ohne Shopify-API).
//   npx tsx scripts/test-match.ts
import { extractOrderNumber } from "../src/lib/shopify/order-match";
import { trackingUrl } from "../src/lib/shopify/client";

let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (erwartet ${JSON.stringify(want)})`}`);
}

// extractOrderNumber
eq("#335675775 im Text", extractOrderNumber("Wo bleibt meine Bestellung?", "Bestellnummer: #335675775\nLG"), "335675775");
eq("#1001 im Betreff", extractOrderNumber("Frage zu #1001", null), "1001");
eq("Bestellnummer ohne #", extractOrderNumber(null, "Meine Bestellnummer 12345 bitte prüfen"), "12345");
eq("Order-Keyword", extractOrderNumber("order 998877", null), "998877");
eq("nur Telefonnr -> null", extractOrderNumber("Rückruf", "Bitte ruft mich an: 0176 12"), null);
eq("kein Treffer -> null", extractOrderNumber("Allgemeine Frage", "Hallo, wie geht es euch?"), null);

// trackingUrl
eq("bevorzugt gelieferte URL", trackingUrl({ url: "https://x/track", number: "1", company: "DHL" }), "https://x/track");
eq("DHL-URL gebaut", trackingUrl({ url: null, number: "00340434789508564238", company: "DHL" }), "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434789508564238");
eq("DPD erkannt", (trackingUrl({ url: null, number: "5", company: "DPD" }) ?? "").includes("dpd.de"), true);
eq("Fallback Google-Suche", (trackingUrl({ url: null, number: "9", company: "Wuppertal Express" }) ?? "").includes("google.com/search"), true);
eq("ohne Nummer -> null", trackingUrl({ url: null, number: null, company: "DHL" }), null);

console.log(fail === 0 ? "\nAlle Tests grün." : `\n${fail} Test(s) fehlgeschlagen.`);
process.exit(fail === 0 ? 0 : 1);
