// Standard-Schnellantworten für einen Brand anlegen/aktualisieren (alles in Sie-Form).
//   Ausführen (lokal oder in der Render-Shell):  npx tsx scripts/seed-standard-replies.ts <slug>
//   Gemeinsames Sie-Basis-Set + brandspezifische Extras:
//     Repello: Wirkung-braucht-Zeit, Reklamation, Positives Feedback
//     Lovenja: Gravur-Vorlagen + Storno-abgelehnt (personalisiert)
//   Bestehende Titel werden AKTUALISIERT (Text wird überschrieben), neue angelegt.
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";

const RULES =
  "Antworte GENAU in diesem Wortlaut und Ton (Sie-Form). Beginne mit der Anrede (Hallo Herr/Frau [Nachname],). " +
  "Passe nur Anrede und konkrete Bestelldaten an, erfinde nichts. " +
  "Schreibe KEINE Grussformel und KEINE Signatur am Ende — die feste Signatur wird automatisch angehaengt.\n\nWortlaut:\n";

const TRACK =
  "Nenne IMMER die echte Trackingnummer und den echten Sendungslink aus den Bestelldaten (Feld Sendungslink). " +
  "Falls keine Trackingnummer vorliegt, sage stattdessen, dass sie in Kuerze aktiviert wird.\n\n";

type Reply = { title: string; body: string };

// ---------- Gemeinsames Sie-Basis-Set (beide Brands) ----------
const buildShared = (shopName: string): Reply[] => [
  {
    title: "Wo ist meine Bestellung? (mit Tracking)",
    body:
      RULES.replace("Wortlaut:\n", "") + TRACK + "Wortlaut:\n" +
      "vielen Dank für Ihre Nachricht. Ich verstehe sehr gut, wie frustrierend es ist, wenn man sehnsüchtig auf seine Bestellung wartet. Leider kommt es aktuell bei unserem Versandpartner zu Verzögerungen, weshalb Sie Ihr Paket noch nicht erhalten haben. Wir entschuldigen uns an dieser Stelle dafür.\n\n" +
      "Ihre Tracking-Nummer lautet: [echte Trackingnummer]\n\n" +
      "Hier können Sie Ihre Bestellung verfolgen:\n[echter Sendungslink]\n\n" +
      "Ihr Paket sollte schon ganz bald bei Ihnen eintreffen. Wir bitten Sie noch um ein klein wenig Geduld und entschuldigen uns herzlichst für die Wartezeit.",
  },
  {
    title: "Tracking noch nicht aktiv",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht!\n\n" +
      "Ihre Bestellung wurde dem Versandunternehmen bereits übergeben. Die Tracking-Nummer wird in Kürze aktiviert — leider kommt es aktuell bei unserem Versandpartner zu leichten Verzögerungen bei der Übermittlung der Sendungsdaten. Sobald Ihre Tracking-Nummer aktiviert wurde, können Sie Ihre Bestellung online verfolgen.\n\n" +
      "Bitte haben Sie noch ein klein wenig Geduld, in der Regel wird die Sendung sehr bald im System sichtbar.\n\n" +
      "Ihre Zufriedenheit liegt uns sehr am Herzen — melden Sie sich jederzeit, falls Sie weitere Fragen haben oder ein Update wünschen.",
  },
  {
    title: "Lieferzeit erklären",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht!\n\n" +
      "Nach Zahlungseingang wird Ihre Bestellung in der Regel innerhalb von 1–3 Werktagen an unseren Versandpartner übergeben. Die anschließende Lieferzeit beträgt meist 5–10 Werktage, je nach Region und Auslastung des Versanddienstleisters.\n\n" +
      "Leider kann es aktuell bei unserem Versandpartner in Einzelfällen zu leichten Verzögerungen kommen — wir bitten Sie dafür herzlich um Verständnis.\n\n" +
      "Bei weiteren Fragen melden Sie sich bitte jederzeit gern.",
  },
  {
    title: "Kein genauer Liefertermin möglich",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht!\n\n" +
      "Nach Zahlungseingang wird Ihre Bestellung in der Regel innerhalb von 1–3 Werktagen an unseren Versandpartner übergeben. Die anschließende Lieferzeit beträgt meist 5–10 Werktage, je nach Region und Auslastung des Versanddienstleisters.\n\n" +
      "Da die Verantwortung der Lieferung in den Händen des Versandunternehmens liegt, können wir leider keinen genauen Liefertermin benennen, da wir keinen Einfluss darauf haben. Wir bitten an dieser Stelle um Ihr Verständnis.\n\n" +
      "Wir entschuldigen uns für die entstandene Wartezeit und wünschen Ihnen noch eine angenehme Woche.",
  },
  {
    title: "Kundendaten erfragen",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht.\n\n" +
      "Damit wir Ihnen bezüglich Ihrer Bestellung weiterhelfen können, bitten wir Sie höflichst, uns Ihren vollständigen Namen, Ihre Mail-Adresse, Sendungsnummer oder Bestellnummer mitzuteilen. So finden wir Sie auch schneller in unserer Kunden-Datenbank.\n\n" +
      "Wir wünschen Ihnen noch eine schöne Woche und stehen Ihnen gerne für weitere Fragen zur Verfügung.",
  },
  {
    title: "Kunde nicht im System gefunden",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht, aber leider finde ich Sie unter dieser Mail-Adresse nicht in unserem System. Auch mit Ihrem Namen habe ich diesbezüglich kein Glück.\n\n" +
      "Bitte überprüfen Sie nochmals Ihre Bestellung und wo Sie diese aufgegeben haben. Oft hilft auch die Überprüfung des Browserverlaufs am Endgerät. Es kommt bei uns immer wieder mal vor, dass wir mit einem anderen Anbieter verwechselt wurden.\n\n" +
      "Wir wünschen Ihnen viel Glück und stehen Ihnen gerne für weitere Fragen zur Verfügung.",
  },
  {
    title: "Retoure: Adresse + SORRY20",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht und es ist schade, dass Sie mit Ihrer Bestellung nicht zufrieden sind.\n\n" +
      "Bitte senden Sie die Ware in ungenutztem Zustand und in der Originalverpackung an folgende Adresse zurück:\n\n" +
      `${shopName} Retourenabteilung:\nRoland Potlog, Aufeldstraße 21, 4050 Traun, Österreich\n\n` +
      "(Bitte geben Sie stets die betreffende Bestellnummer und Ihre vollständige Adresse an)\n\n" +
      "Sobald Ihre Rücksendung bei uns eingetroffen und geprüft ist, erfolgt die Erstattung automatisch auf das von Ihnen genutzte Zahlungsmittel. Sie erhalten hierzu selbstverständlich eine Bestätigung per E-Mail. Einen Rücksendeschein bieten wir leider nicht an und wir bitten Sie an dieser Stelle um Ihr Verständnis.\n\n" +
      "Es tut uns leid, dass die Bestellung diesmal nicht Ihren Vorstellungen entsprochen hat. Als kleine Geste möchten wir Ihnen dennoch einen 20 % Rabattcode für Ihren nächsten Einkauf anbieten: SORRY20 — vielleicht dürfen wir Sie ja bald wieder mit etwas Schönem überraschen.\n\n" +
      "Bei Fragen zur Rücksendung oder zum Ablauf stehen wir Ihnen selbstverständlich jederzeit gerne zur Verfügung.",
  },
  {
    title: "Paket zugestellt / in Filiale",
    body:
      RULES.replace("Wortlaut:\n", "") + TRACK + "Wortlaut:\n" +
      "vielen Dank für Ihre Nachricht.\n\n" +
      "Laut der Sendungsverfolgung wurde Ihr Paket von DHL zugestellt oder befindet sich in der Regel in der nächsten DHL-Filiale zur Abholung bereit.\n\n" +
      "Wir empfehlen Ihnen, dort kurz nachzufragen — häufig wird das Paket aus Sicherheitsgründen hinterlegt, ohne dass sofort eine Benachrichtigung im Briefkasten liegt.\n\n" +
      "Ihre Sendungsnummer lautet: [echte Trackingnummer]\n\n" +
      "Hier können Sie nachschauen, wo sich Ihre nächste DHL-Filiale befindet:\nhttps://www.dhl.de/de/privatkunden/pakete-versenden/pakete-abgeben/filiale.html\n\n" +
      "Wir wünschen Ihnen noch eine angenehme Woche und stehen Ihnen gerne für weitere Fragen zur Verfügung.",
  },
  {
    title: "Paket kam zurück (Adresse prüfen)",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht und Ihr Paket wurde wahrscheinlich wegen abweichender oder nicht zustellbarer Adresse an uns zurückgesendet.\n\n" +
      "Könnten Sie uns bitte Ihre genaue Adresse angeben, damit wir einen Datenabgleich machen können?\n\n" +
      "Wir entschuldigen uns für die Umstände und würden sofort nach Erhalt der Ware diese wieder erneut an Sie versenden.\n\n" +
      "Für weitere Fragen stehen wir Ihnen jederzeit gerne zur Verfügung.",
  },
  {
    title: "Lieferadresse unvollständig",
    body:
      RULES +
      "wir bedanken uns herzlichst für Ihre Bestellung.\n\n" +
      "Damit wir diese auch versenden können, bitten wir Sie, kurz Ihre aktuelle Lieferadresse zu bestätigen, da diese unvollständig ist (fehlende Hausnummer).\n\n" +
      "📦 Bitte bestätigen Sie:\nVorname und Nachname\nStraße & Hausnummer\nPostleitzahl & Ort\n\n" +
      "Vielen Dank für Ihre Geduld und Ihr Verständnis — Ihre Zufriedenheit liegt uns sehr am Herzen.",
  },
  {
    title: "Storno → an Versand weitergeleitet",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht und ich habe Ihre Stornierung an die Versandabteilung weitergeleitet.\n\n" +
      "Sobald ich von dort eine Rückmeldung erhalten habe, werde ich die Gutschrift auf Ihr hinterlegtes Konto anweisen.\n\n" +
      "Wir wünschen Ihnen noch eine schöne Woche und stehen Ihnen gerne für weitere Fragen zur Verfügung.",
  },
];

// ---------- Repello-Extras (Sie-Form) ----------
const repelloExtras = (shopName: string): Reply[] => [
  {
    title: "Wirkung braucht Zeit (Produktfrage)",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht 😊\n\n" +
      "Je nach Tierart und Umgebung kann es etwas Zeit dauern, bis die gewünschte Wirkung vollständig eintritt. Wichtig ist, dass das Gerät dauerhaft und entsprechend der Anleitung eingesetzt wird. 🌿\n\n" +
      "Beschreiben Sie uns gerne kurz, welches Produkt Sie verwenden und gegen welches Tier es eingesetzt wird — dann helfen wir Ihnen konkret weiter. 👍",
  },
  {
    title: "Reklamation: Lösung anbieten",
    body:
      RULES +
      "vielen Dank für Ihr Feedback.\n\n" +
      "Schade, dass Ihre Erfahrung nicht wie gewünscht verlaufen ist — das tut uns leid.\n\n" +
      "Senden Sie uns bitte kurz Ihre Bestellnummer (und gern Fotos), damit wir uns Ihren Fall persönlich ansehen können.\n\n" +
      "Gemeinsam finden wir eine passende Lösung. 😊",
  },
  {
    title: "Positives Feedback bedanken",
    body:
      RULES +
      "vielen Dank für Ihr tolles Feedback! 😊\n\n" +
      `Es freut uns sehr zu hören, dass Sie gute Erfahrungen mit Ihrem ${shopName}-Produkt gemacht haben.\n\n` +
      "Wir wünschen Ihnen weiterhin ein geschütztes Zuhause und viel Freude mit Ihrem Produkt. 🏡",
  },
];

// ---------- Lovenja-Extras (Sie-Form, Gravur) ----------
const lovenjaExtras = (): Reply[] => [
  {
    title: "Gravur-Namen erfragen",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht und gerne können Sie mir mitteilen, welche Namen Sie eingraviert haben möchten.\n\n" +
      "1. Name:\n\n2. Name:\n\n" +
      "Wir bedanken uns für Ihre Bestellung und wünschen Ihnen noch eine schöne Woche.",
  },
  {
    title: "Gravur-Namen weitergeleitet",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht und ich habe soeben Ihre Namenswünsche an die Gravur-Abteilung zur Bearbeitung weitergeleitet.\n\n" +
      "Wir bedanken uns für Ihre Bestellung und stehen Ihnen gerne für weitere Fragen zur Verfügung.",
  },
  {
    title: "Storno abgelehnt (Gravur/personalisiert)",
    body:
      RULES +
      "vielen Dank für Ihre Nachricht.\n\n" +
      "Es tut uns sehr leid, dass Sie Ihre Bestellung stornieren möchten.\n\n" +
      "Da Ihr Artikel individuell mit einer Gravur angefertigt wurde, ist eine Rückgabe, Stornierung oder Gutschrift leider nicht möglich. Bitte haben Sie Verständnis dafür, dass personalisierte Produkte speziell für Sie hergestellt werden und somit vom Widerrufsrecht ausgeschlossen sind. Der Artikel lässt sich aufgrund der Gravur leider nicht mehr zum weiteren Verkauf anbieten.\n\n" +
      "Sollten Sie noch Fragen haben, so stehen wir Ihnen gerne zur Verfügung.",
  },
];

async function main() {
  const slug = (process.argv[2] ?? "").toLowerCase();
  if (!slug) {
    console.error("Aufruf: npx tsx scripts/seed-standard-replies.ts <slug>   (z. B. repello oder lovenja)");
    process.exit(1);
  }
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.slug, slug) });
  if (!shop) {
    console.error(`Shop mit Slug "${slug}" nicht gefunden. Vorhandene Slugs siehe Admin -> Brands.`);
    process.exit(1);
  }
  const isLovenja = slug.includes("lovenja");
  const REPLIES = [...buildShared(shop.name), ...(isLovenja ? lovenjaExtras() : repelloExtras(shop.name))];
  let added = 0;
  let updated = 0;
  for (const [i, r] of REPLIES.entries()) {
    const exists = await db.query.cannedReply.findFirst({
      where: and(eq(schema.cannedReply.shopId, shop.id), eq(schema.cannedReply.title, r.title)),
    });
    if (exists) {
      await db
        .update(schema.cannedReply)
        .set({ body: r.body, sort: i + 1 })
        .where(eq(schema.cannedReply.id, exists.id));
      updated++;
      continue;
    }
    await db.insert(schema.cannedReply).values({ shopId: shop.id, title: r.title, body: r.body, sort: i + 1 });
    added++;
  }
  console.log(`${shop.name} (Sie-Form${isLovenja ? ", Lovenja-Extras" : ", Repello-Extras"}): ${added} neu, ${updated} aktualisiert.`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
