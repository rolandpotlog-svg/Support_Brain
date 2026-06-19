// Demo-Tickets zum Sichtbarmachen des Designs. Idempotent: leert vorhandene Threads.
//   npm run seed:demo
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

async function main() {
  const shop = await db.query.shops.findFirst({
    where: eq(schema.shops.slug, "reppello"),
  });
  if (!shop) {
    console.error('Kein Shop "reppello" gefunden. Erst im Admin anlegen.');
    process.exit(1);
  }

  await db.delete(schema.threads); // Demo neu aufbauen

  const tickets = [
    {
      name: "Maria",
      email: "maria@outlook.de",
      subject: "Wo bleibt meine Bestellung?",
      tag: "Bestellstatus",
      status: "open" as const,
      ageMs: 18 * MIN,
      body:
        "Guten Tag,\n\nleider ist meine Bestellung noch nicht angekommen. Wo bleibt sie?\n" +
        "Bestellnummer: #335675775\n\nLG,\nMaria",
    },
    {
      name: "Svenja",
      email: "svenja.koch@gmail.com",
      subject: "Retoure Anmelden",
      tag: "Beschädigte Ware",
      status: "open" as const,
      ageMs: 4 * DAY,
      body: "Hallo, ein Artikel kam beschädigt an. Wie melde ich eine Retoure an?",
    },
    {
      name: "Paul Frenge",
      email: "paul.frenge@web.de",
      subject: "Bestellung Zurücksenden",
      tag: "Retoure/Umtausch",
      status: "open" as const,
      ageMs: 5 * DAY,
      body: "Ich möchte meine Bestellung zurücksenden und umtauschen. Geht das?",
    },
    {
      name: "Michael",
      email: "michael.bauer@gmx.de",
      subject: "Bitte um Hilfe",
      tag: "Beschädigte Ware",
      status: "open" as const,
      ageMs: 5 * DAY,
      body: "Hallo, ich brauche Hilfe mit einem defekten Produkt.",
    },
    {
      name: "Laura Schmidt",
      email: "laura.schmidt@gmail.com",
      subject: "Rechnung benötigt",
      tag: "Bestellstatus",
      status: "closed" as const,
      ageMs: 9 * DAY,
      body: "Könnten Sie mir bitte die Rechnung zu meiner Bestellung schicken?",
    },
    {
      name: "Gewinnspiel",
      email: "noreply@spammail.xyz",
      subject: "Sie haben gewonnen!!!",
      tag: null,
      status: "spam" as const,
      ageMs: 2 * DAY,
      body: "Herzlichen Glückwunsch, klicken Sie hier...",
    },
  ];

  for (const t of tickets) {
    const at = new Date(Date.now() - t.ageMs);
    const [thread] = await db
      .insert(schema.threads)
      .values({
        shopId: shop.id,
        subject: t.subject,
        customerEmail: t.email,
        customerName: t.name,
        status: t.status,
        tag: t.tag,
        lastMessageAt: at,
        createdAt: at,
      })
      .returning({ id: schema.threads.id, number: schema.threads.number });
    await db.insert(schema.messages).values({
      threadId: thread.id,
      direction: "inbound",
      fromEmail: t.email,
      toEmail: "support@reppello.com",
      subject: t.subject,
      bodyText: t.body,
      messageId: `<demo-${thread.number}@support-brain>`,
      createdAt: at,
    });
    console.log(`#${thread.number}  ${t.name} — ${t.subject}`);
  }
  console.log("Demo-Tickets angelegt.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
