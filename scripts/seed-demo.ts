// Demo-Tickets zum Sichtbarmachen des Designs (zwei Shops, damit der
// Shop-Umschalter sichtbar ist). Idempotent: legt fehlende Shops an und
// baut die Threads neu auf.
//   npm run seed:demo
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type Ticket = {
  name: string;
  email: string;
  subject: string;
  tag: string | null;
  status: "open" | "pending" | "escalated" | "closed" | "spam";
  ageMs: number;
  body: string;
};

/** Shop per slug holen oder anlegen. */
async function ensureShop(slug: string, name: string): Promise<string> {
  const existing = await db.query.shops.findFirst({ where: eq(schema.shops.slug, slug) });
  if (existing) return existing.id;
  const [created] = await db
    .insert(schema.shops)
    .values({ slug, name })
    .returning({ id: schema.shops.id });
  console.log(`Shop "${name}" (${slug}) angelegt.`);
  return created.id;
}

async function seedTickets(shopId: string, supportEmail: string, tickets: Ticket[]) {
  for (const t of tickets) {
    const at = new Date(Date.now() - t.ageMs);
    const [thread] = await db
      .insert(schema.threads)
      .values({
        shopId,
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
      toEmail: supportEmail,
      subject: t.subject,
      bodyText: t.body,
      messageId: `<demo-${thread.number}@support-brain>`,
      createdAt: at,
    });
    console.log(`#${thread.number}  ${t.name} — ${t.subject}`);
  }
}

const reppelloTickets: Ticket[] = [
  {
    name: "Maria",
    email: "maria@outlook.de",
    subject: "Wo bleibt meine Bestellung?",
    tag: "Bestellstatus",
    status: "open",
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
    status: "open",
    ageMs: 4 * DAY,
    body: "Hallo, ein Artikel kam beschädigt an. Wie melde ich eine Retoure an?",
  },
  {
    name: "Paul Frenge",
    email: "paul.frenge@web.de",
    subject: "Bestellung Zurücksenden",
    tag: "Retoure/Umtausch",
    status: "open",
    ageMs: 5 * DAY,
    body: "Ich möchte meine Bestellung zurücksenden und umtauschen. Geht das?",
  },
  {
    name: "Michael",
    email: "michael.bauer@gmx.de",
    subject: "Bitte um Hilfe",
    tag: "Beschädigte Ware",
    status: "open",
    ageMs: 5 * DAY,
    body: "Hallo, ich brauche Hilfe mit einem defekten Produkt.",
  },
  {
    name: "Laura Schmidt",
    email: "laura.schmidt@gmail.com",
    subject: "Rechnung benötigt",
    tag: "Bestellstatus",
    status: "closed",
    ageMs: 9 * DAY,
    body: "Könnten Sie mir bitte die Rechnung zu meiner Bestellung schicken?",
  },
  {
    name: "Gewinnspiel",
    email: "noreply@spammail.xyz",
    subject: "Sie haben gewonnen!!!",
    tag: null,
    status: "spam",
    ageMs: 2 * DAY,
    body: "Herzlichen Glückwunsch, klicken Sie hier...",
  },
];

const norvanaTickets: Ticket[] = [
  {
    name: "Jonas Wehler",
    email: "jonas.wehler@gmail.com",
    subject: "Lieferzeit nach Österreich?",
    tag: "Bestellstatus",
    status: "open",
    ageMs: 35 * MIN,
    body: "Hallo, wie lange dauert der Versand nach Österreich? Bestellnummer #1042.",
  },
  {
    name: "Aylin Demir",
    email: "aylin.demir@web.de",
    subject: "Falsche Größe erhalten",
    tag: "Retoure/Umtausch",
    status: "open",
    ageMs: 3 * DAY,
    body: "Ich habe Größe M bestellt, aber S erhalten. Wie tausche ich um?",
  },
  {
    name: "Tobias Renner",
    email: "t.renner@gmx.net",
    subject: "Rabattcode funktioniert nicht",
    tag: "Sonstiges",
    status: "pending",
    ageMs: 1 * DAY,
    body: "Mein Code WELCOME10 wird im Checkout nicht akzeptiert. Könnt ihr helfen?",
  },
  {
    name: "Sandra Vogel",
    email: "sandra.vogel@outlook.com",
    subject: "Defektes Produkt – dringend",
    tag: "Beschädigte Ware",
    status: "escalated",
    ageMs: 6 * DAY,
    body: "Das Gerät funktioniert nicht mehr nach zwei Tagen. Ich bin sehr unzufrieden.",
  },
  {
    name: "Werbung",
    email: "promo@billig-deals.xyz",
    subject: "Steigern Sie Ihren Umsatz!!!",
    tag: null,
    status: "spam",
    ageMs: 12 * MIN,
    body: "Jetzt 300% mehr Verkäufe mit unserem Tool...",
  },
];

async function main() {
  const reppelloId = await ensureShop("reppello", "Reppello");
  const norvanaId = await ensureShop("norvana", "Norvana");

  await db.delete(schema.threads); // Demo neu aufbauen (Messages hängen per cascade)

  console.log("\n— Reppello —");
  await seedTickets(reppelloId, "support@reppello.com", reppelloTickets);
  console.log("\n— Norvana —");
  await seedTickets(norvanaId, "support@norvana.de", norvanaTickets);

  console.log("\nDemo-Tickets für beide Shops angelegt.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
