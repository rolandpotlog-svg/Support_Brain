// End-to-End-Test Schattenbetrieb gegen einen lokalen Test-IMAP-Server (NICHT gegen echte Postfächer).
//   NODE_TLS_REJECT_UNAUTHORIZED=0 npx tsx scripts/test-shadow.ts <slug> <host> <port> <user> <pass>
// Prüft: Postfach bleibt unverändert (keine \Seen-Flags, keine neuen Ordner), Ticket + KI-Entwurf entstehen,
// eine Antwort im Gesendet-Ordner wird dem Ticket zugeordnet und mit dem Entwurf verglichen.
import "dotenv/config";
import { ImapFlow } from "imapflow";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/server/db/index";
import { encrypt } from "../src/lib/mailbox/crypto";
import { ingestMailbox } from "../worker/imap";
import { autoDraftRecent } from "../src/server/ai/autodraft";

const [slug, host, port, user, pass] = process.argv.slice(2);

async function serverState() {
  const c = new ImapFlow({ host, port: Number(port), secure: true, auth: { user, pass }, logger: false });
  await c.connect();
  const folders = (await c.list()).map((f) => f.path).sort();
  const lock = await c.getMailboxLock("INBOX", { readOnly: true });
  const flags: string[][] = [];
  for await (const m of c.fetch("1:*", { flags: true })) flags.push([...(m.flags ?? [])]);
  lock.release();
  await c.logout();
  return { folders, flags };
}

async function main() {
  if (!host) throw new Error("Aufruf: scripts/test-shadow.ts <slug> <host> <port> <user> <pass>");
  const shop = await db.query.shops.findFirst({ where: eq(schema.shops.slug, slug) });
  if (!shop) throw new Error("Shop fehlt");
  await db.delete(schema.shopMailboxes).where(and(eq(schema.shopMailboxes.shopId, shop.id), eq(schema.shopMailboxes.imapHost, host)));
  const [mb] = await db
    .insert(schema.shopMailboxes)
    .values({
      shopId: shop.id, imapHost: host, imapPort: Number(port), imapUser: user, imapPasswordEnc: encrypt(pass),
      smtpHost: host, smtpPort: 9465, smtpUser: user, smtpPasswordEnc: encrypt(pass),
      fromEmail: "info@lovenja.test", shadowMode: true,
    })
    .returning();

  const before = await serverState();
  console.log("Vorher:", JSON.stringify(before));

  // 1) Eingang lesen (Schattenbetrieb)
  console.log("Ingest #1:", await ingestMailbox(shop, mb));
  const mb1 = (await db.query.shopMailboxes.findFirst({ where: eq(schema.shopMailboxes.id, mb.id) }))!;
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.mailboxId, mb.id) });
  if (!thread) throw new Error("FEHLER: kein Ticket angelegt");
  console.log("Ticket:", thread.subject, "| Sent-Position gemerkt:", mb1.lastSeenSentUid);

  // 2) KI-Entwurf
  console.log("Auto-Entwürfe:", await autoDraftRecent());
  const t2 = (await db.query.threads.findFirst({ where: eq(schema.threads.id, thread.id) }))!;
  console.log("Entscheidung:", t2.aiDecision, "|", t2.aiReason, "\n--- Entwurf ---\n" + t2.lastAiDraft + "\n---");

  // 3) Team antwortet im Webmail (Mail landet im Gesendet-Ordner)
  const c = new ImapFlow({ host, port: Number(port), secure: true, auth: { user, pass }, logger: false });
  await c.connect();
  const reply = [
    "From: Lovenja <info@lovenja.test>",
    "To: sabine.test@example.com",
    "Subject: Re: Wo bleibt meine Kette?",
    "Message-ID: <webmail-reply-1@lovenja.test>",
    "In-Reply-To: <kunde-1@example.com>",
    "References: <kunde-1@example.com>",
    "Date: " + new Date().toUTCString(),
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hallo Frau Krueger,",
    "",
    "es tut uns sehr leid, dass Sie noch warten muessen. Leider kommt es aktuell bei unserem Versandpartner zu Verzoegerungen.",
    "Als kleine Entschuldigung schenken wir Ihnen den Rabattcode SORRY20.",
    "Sollten Sie noch Fragen haben, schreiben Sie uns jederzeit gerne.",
    "",
    "Liebe Gruesse",
    "Roland & das Lovenja Team",
    "",
    "Am 30.09.2026 um 10:00 schrieb Sabine Krueger:",
    "> Hallo, ich habe vor 12 Tagen bestellt ...",
  ].join("\r\n");
  await c.append("Gesendet", reply, ["\\Seen"]);
  await c.logout();

  // 4) Gesendet mitlesen + vergleichen
  console.log("Ingest #2:", await ingestMailbox(shop, mb1));
  const out = await db.query.messages.findFirst({
    where: and(eq(schema.messages.threadId, thread.id), eq(schema.messages.direction, "outbound")),
  });
  const t3 = (await db.query.threads.findFirst({ where: eq(schema.threads.id, thread.id) }))!;
  console.log("Webmail-Antwort übernommen:", Boolean(out), "| Zitat entfernt:", !out?.bodyText?.includes("schrieb"));
  console.log("Vergleich: passt =", out?.aiShadowMatch, "| Lektion:", out?.aiShadowNote, "| outcome:", out?.aiOutcome);
  console.log("Ticket-Status:", t3.status, "| Entwurf geleert:", t3.lastAiDraft === null);

  const after = await serverState();
  console.log("Nachher:", JSON.stringify(after));
  const sameFolders = JSON.stringify(before.folders) === JSON.stringify(after.folders);
  const noSeen = after.flags.every((f) => !f.includes("\\Seen"));
  console.log(sameFolders && noSeen ? "✅ Postfach unverändert (keine Ordner, keine Gelesen-Markierung)" : "❌ Postfach wurde verändert!");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
