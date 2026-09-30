// Qualitäts-Test für KI-Antwortentwürfe — ohne DB/Login, mit exakt demselben Prompt wie im Tool.
//   npx tsx scripts/eval-drafts.ts            (Lovenja-Standardprofil, alle Testfälle)
//   npx tsx scripts/eval-drafts.ts 3 7        (nur Fall 3 und 7)
// Ablauf je Fall: Entwurf erzeugen -> zweiter KI-Aufruf prüft ihn gegen Profil + Checkliste
// -> Bericht nach backups/eval-<datum>.md (gitignored-Ordner, kein Kundenbezug: Testfälle sind erfunden).
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { complete } from "@/server/ai";
import { buildSystemPrompt } from "@/lib/profile/types";
import { draftSystemPrompt, parseDraft } from "@/server/ai/draft-prompt";
import { LOVENJA_PROFILE } from "@/server/seed-lovenja";

type Case = { title: string; customer: string; subject: string; history: string; shopify: string; expect: string; want: "auto" | "mensch" };

const ORDER = (o: { tracking?: string; ageDays: number; items: string; fulfilled?: boolean }) =>
  [
    `Bestellung #4711 vom ${new Date(Date.now() - o.ageDays * 86_400_000).toLocaleDateString("de-DE")} (vor ${o.ageDays} Tag(en))`,
    `Zahlung: PAID · Versand: ${o.fulfilled === false ? "UNFULFILLED" : "FULFILLED"} · Summe: 39,95 €`,
    o.tracking ? `Tracking: DHL ${o.tracking} — Sendungslink: https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${o.tracking}` : "Tracking: keins hinterlegt",
    `Artikel: ${o.items}`,
  ].join("\n");

const CASES: Case[] = [
  {
    title: "Normale Verzögerung, Tracking vorhanden",
    customer: "Sabine Krüger", subject: "Wo bleibt meine Kette?",
    history: "Sabine Krüger: Hallo, ich habe vor 12 Tagen bestellt und immer noch nichts bekommen. Wann kommt meine Kette?",
    shopify: ORDER({ tracking: "00340434161094042557", ageDays: 12, items: "1× Mutter-Tochter-Halskette Gravur (Gelbgold)" }),
    want: "auto",
    expect: "Entschuldigung, Versandpartner-Verzögerung, echte Trackingnummer+Link, SORRY20, Einladung sich zu melden, kein Liefertermin",
  },
  {
    title: "Sehr verärgert, droht mit Bewertung",
    customer: "Thomas Brandt", subject: "Unverschämt!!!",
    history: "Thomas Brandt: Das ist eine absolute Frechheit. 3 Wochen warte ich schon, das Geschenk war für den Geburtstag meiner Frau. Ich werde überall schlechte Bewertungen schreiben! Wo ist mein Paket???",
    shopify: ORDER({ tracking: "00340434161094099911", ageDays: 21, items: "1× Lovebox Deluxe ewige Rose mit Herzschmuck" }),
    want: "auto",
    expect: "ruhig, Ärger ernst nehmen, nicht defensiv, Tracking, SORRY20, kein Liefertermin versprechen",
  },
  {
    title: "Fragt erneut nach (SORRY20 schon erhalten)",
    customer: "Julia Hofmann", subject: "Re: Bestellung #4711",
    history:
      "Julia Hofmann: Hallo, meine Bestellung ist noch nicht da.\n\nSupport: Hallo Frau Hofmann, es tut uns wirklich leid ... Als kleine Entschuldigung möchten wir Ihnen gerne den Rabattcode SORRY20 anbieten. ...\n\nJulia Hofmann: Jetzt ist schon wieder eine Woche vergangen und das Tracking bewegt sich nicht.",
    shopify: ORDER({ tracking: "00340434161094055555", ageDays: 19, items: "1× Namenskette 2 Namen (Weißgold)" }),
    want: "mensch",
    expect: "erneute Meldung anerkennen, NICHT noch einmal SORRY20, nicht dieselbe Mail wiederholen, kein erfundener Status",
  },
  {
    title: "Storno gravierter Artikel",
    customer: "Monika Schulz", subject: "Stornierung",
    history: "Monika Schulz: Ich habe mich vertan und möchte die Bestellung von gestern bitte stornieren. Danke.",
    shopify: ORDER({ ageDays: 1, items: "1× Mutter-Tochter-Halskette Gravur 'Lea & Mia'", fulfilled: false }),
    want: "auto",
    expect: "freundlich ablehnen (personalisiert), Verständnis, nicht belehrend, ggf. SORRY20, keine Paragraphen-Drohung",
  },
  {
    title: "Gravur fehlt",
    customer: "Anna Wolf", subject: "Keine Gravur!",
    history: "Anna Wolf: Die Kette ist heute angekommen aber es ist gar nichts eingraviert. Ich bin sehr enttäuscht.",
    shopify: ORDER({ tracking: "00340434161094012345", ageDays: 9, items: "1× Namenskette Gravur 'Emma'" }),
    want: "auto",
    expect: "aufrichtige Entschuldigung, Foto + Namen erbitten, kostenfreie Ersatzlieferung zusagen",
  },
  {
    title: "Tracking zeigt China",
    customer: "Peter Neumann", subject: "Kommt das aus China?",
    history: "Peter Neumann: Ich dachte ihr seid ein deutscher Shop. Im Tracking steht Shenzhen. Ist das Dropshipping?",
    shopify: ORDER({ tracking: "YT2412345678901234", ageDays: 6, items: "1× Armband Gravur" }),
    want: "auto",
    expect: "internationale Versandlager, KEIN Dropshipping/China-Lieferant/AliExpress, nicht 'deutsches Unternehmen' behaupten",
  },
  {
    title: "Echtgold-Frage",
    customer: "Claudia Richter", subject: "Echtes Gold?",
    history: "Claudia Richter: Ist die Kette aus echtem Gold? Ich finde keinen Stempel und es war kein Zertifikat dabei.",
    shopify: ORDER({ tracking: "00340434161094077777", ageDays: 14, items: "1× Herzkette 14K vergoldet" }),
    want: "auto",
    expect: "transparent: vergoldet, kein Massivgold, keine Punze/Zertifikat nur bei Echtgold",
  },
  {
    title: "Anlaufen nach 2 Monaten (muss eskalieren)",
    customer: "Sandra Becker", subject: "Kette verfärbt",
    history: "Sandra Becker: Meine Kette ist nach 2 Monaten ganz dunkel geworden. Ich will mein Geld zurück, das ist ein Mangel!",
    shopify: ORDER({ tracking: "00340434161094088888", ageDays: 65, items: "1× Namenskette Gravur (Roségold)" }),
    want: "mensch",
    expect: "NICHT selbst ablehnen und kein Geld zusagen; freundlich, Fotos erbitten ok; muss als Eskalationsfall erkennbar sein",
  },
  {
    title: "Anwalt/PayPal-Drohung (muss eskalieren)",
    customer: "Markus Lange", subject: "Letzte Frist",
    history: "Markus Lange: Wenn ich bis Freitag nicht mein Geld zurück habe, eröffne ich einen PayPal-Fall und schalte meinen Anwalt ein.",
    shopify: ORDER({ tracking: "00340434161094066666", ageDays: 25, items: "1× Lovebox Deluxe" }),
    want: "mensch",
    expect: "nichts zusagen, deeskalieren, keine Rechtsargumente, Eskalationsfall",
  },
  {
    title: "Kein Shopify-Treffer",
    customer: "", subject: "Bestellung",
    history: "Kunde: Hallo wo ist meine Bestellung",
    shopify: "Kein Shopify-Treffer für diesen Kunden/diese Bestellung.",
    want: "auto",
    expect: "Guten Tag, freundlich Bestellnummer/Name/E-Mail erfragen, nichts erfinden",
  },
  {
    title: "Tracking noch nicht aktiv",
    customer: "Laura Schmitt", subject: "Tracking geht nicht",
    history: "Laura Schmitt: Die Sendungsnummer funktioniert nicht, da steht nichts.",
    shopify: ORDER({ ageDays: 3, items: "1× Armband Gravur", fulfilled: false }),
    want: "auto",
    expect: "Sendungsnummer wird in Kürze aktiviert, keine erfundene Nummer",
  },
  {
    title: "Weißgold sieht silbern aus",
    customer: "Nicole Fischer", subject: "Falsche Farbe",
    history: "Nicole Fischer: Ich habe Weißgold bestellt, auf der Packung steht aber Silver. Ich will das bestellte Produkt!",
    shopify: ORDER({ tracking: "00340434161094033333", ageDays: 10, items: "1× Lovebox Deluxe ewige Rose mit Herzschmuck (Weißgold)" }),
    want: "auto",
    expect: "Weißgold ist silbrig, Silver-Custom interne Farbbezeichnung, Verständnis",
  },
  {
    title: "Langer Verlauf: WISMO -> Nachfrage -> beschädigt angekommen",
    customer: "Petra Lang", subject: "Re: Re: Re: Bestellung #4711",
    history:
      "Petra Lang: Hallo, ich habe vor 8 Tagen eine Lovebox bestellt, wann kommt sie?\n\n" +
      "Support: Hallo Frau Lang, vielen Dank für Ihre Nachricht. Ihre Tracking-Nummer lautet 00340434161094011111 ... Liebe Grüße Roland & das Lovenja Team\n\n" +
      "Petra Lang: Das Tracking bewegt sich seit 4 Tagen nicht. Weihnachten ist bald!\n\nAm 12.12. schrieb Lovenja: > Hallo Frau Lang, vielen Dank für Ihre Nachricht. Ihre Tracking-Nummer lautet ...\n\n" +
      "Support: Hallo Frau Lang, es tut uns sehr leid ... Als kleine Entschuldigung möchten wir Ihnen gerne den Rabattcode SORRY20 anbieten. ...\n\n" +
      "Petra Lang: Jetzt ist das Paket endlich da, aber die Box ist total eingedrückt und die Rose ist abgebrochen. So kann ich das nicht verschenken.\n\nAm 15.12. schrieb Lovenja: > Hallo Frau Lang, es tut uns sehr leid ... > SORRY20 ...",
    shopify: ORDER({ tracking: "00340434161094011111", ageDays: 14, items: "1× Lovebox Deluxe ewige Rose mit Herzschmuck" }),
    want: "auto",
    expect: "erkennt: jetzt BESCHÄDIGT (nicht mehr WISMO); Foto erbitten + kostenlosen Ersatz zusagen; KEIN zweites SORRY20; bezieht sich auf den Verlauf; nichts erfinden",
  },
];

const JUDGE_SYSTEM =
  "Du bist die strenge Qualitätsprüfung für Kundensupport-Antworten des Shops Lovenja. " +
  "Du bekommst die Richtlinien des Shops, die Kundenanfrage mit Bestelldaten, die Erwartung und den Antwortentwurf. " +
  "Prüfe hart: Würde der Inhaber diese Mail OHNE jede Änderung abschicken? Prüfe insbesondere: Sie-Form; persönliche Anrede; " +
  "nichts erfunden (Tracking, Termine, Status, erledigte Aktionen, Anhänge); verbotene Wörter (Dropshipping, China-Lieferant, AliExpress, Fulfillment); " +
  "keine Haftungs-/Verantwortungsabwehr; keine Belehrung; kein 'wir melden uns'; SORRY20 nur wenn passend und nicht doppelt; " +
  "Rabatte über SORRY20 hinaus sind verboten; Eskalationsfälle dürfen nichts zusagen; keine Grußformel/Signatur (wird angehängt); natürlicher, nicht schablonenhafter Ton. " +
  'Antworte NUR mit JSON: {"sendefertig":true|false,"note":1-10,"verstoesse":["..."],"verbesserung":"ein Satz"}';

async function main() {
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  const profile = LOVENJA_PROFILE;
  const signature = profile.signature.trim();
  const system = draftSystemPrompt(buildSystemPrompt(profile, "Lovenja"), signature, profile.closing);

  const rows: string[] = [];
  let ok = 0, n = 0, sum = 0, decOk = 0;
  for (const [i, c] of CASES.entries()) {
    if (only.length && !only.includes(i + 1)) continue;
    const userMsg = [
      `KUNDE: ${c.customer} <kunde@example.com>`, `BETREFF: ${c.subject}`, "", "TICKET-VERLAUF:", c.history, "",
      "SHOPIFY-KONTEXT:", c.shopify, "", "Verfasse jetzt die nächste Antwort an den Kunden.",
    ].join("\n");
    const d = parseDraft(await complete({ system, messages: [{ role: "user", content: userMsg }], maxTokens: 8000, effort: (process.env.DRAFT_EFFORT as "low" | "medium" | "high") ?? "high", kind: `eval-${process.env.DRAFT_EFFORT ?? "high"}` }));
    const draft = d.text;
    const decisionOk = d.decision === c.want;
    const verdictRaw = await complete({
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: `RICHTLINIEN:\n${buildSystemPrompt(profile, "Lovenja")}\n\nANFRAGE:\n${userMsg}\n\nERWARTUNG:\n${c.expect}\n\nKI-ENTSCHEIDUNG: ${d.decision.toUpperCase()} (${d.reason})${d.decision === "mensch" ? "\nHinweis: Das ist ein Vorschlag für das Team, der Mensch ergänzt die Entscheidung. Prüfe, ob er als Grundlage taugt und NICHTS zusagt; 'sendefertig' heißt hier: guter, sicherer Vorschlag." : ""}\n\nENTWURF:\n${draft}` }],
      maxTokens: 1500, effort: "medium",
    });
    let v: { sendefertig: boolean; note: number; verstoesse: string[]; verbesserung: string };
    try {
      v = JSON.parse(verdictRaw.replace(/^```(json)?|```$/g, "").trim());
    } catch {
      v = { sendefertig: false, note: 0, verstoesse: ["Prüfer-Antwort nicht lesbar"], verbesserung: verdictRaw.slice(0, 200) };
    }
    n++; sum += v.note; if (v.sendefertig && decisionOk) ok++; if (decisionOk) decOk++;
    const dec = `${d.decision === "auto" ? "AUTO " : "MENSCH"}${decisionOk ? "" : " (soll " + c.want.toUpperCase() + ")"}`;
    console.log(`${String(i + 1).padStart(2)} ${v.sendefertig && decisionOk ? "✅" : "❌"} ${v.note}/10  ${dec}  ${c.title}${v.verstoesse.length ? "  — " + v.verstoesse.join("; ") : ""}`);
    rows.push(
      `## ${i + 1}. ${c.title} — ${v.sendefertig ? "✅ sendefertig" : "❌ nicht sendefertig"} (${v.note}/10)\n\n` +
        `**KI-Entscheidung:** ${dec} — ${d.reason}\n\n**Kunde:** ${c.history.replace(/\n/g, "  \n")}\n\n**Erwartung:** ${c.expect}\n\n` +
        `**Entwurf:**\n\n${draft}\n\n${signature}\n\n` +
        (v.verstoesse.length ? `**Verstöße:** ${v.verstoesse.join("; ")}\n\n` : "") +
        `**Verbesserung:** ${v.verbesserung}\n`,
    );
  }
  const head = `# KI-Entwurf-Test Lovenja — ${new Date().toLocaleString("de-DE")}\n\n**${ok}/${n} bestanden** (Entscheidung richtig: ${decOk}/${n}), Ø Note ${(sum / Math.max(n, 1)).toFixed(1)}/10\n\n`;
  const file = `backups/eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`;
  writeFileSync(file, head + rows.join("\n---\n\n"));
  console.log(`\n${ok}/${n} bestanden (Entscheidung richtig ${decOk}/${n}), Ø ${(sum / Math.max(n, 1)).toFixed(1)}/10 -> ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
