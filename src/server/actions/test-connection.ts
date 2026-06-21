"use server";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireShopsEdit } from "@/server/access";
import { decrypt } from "@/lib/mailbox/crypto";
import { loadShopifyCreds } from "@/server/shopify-config";
import { getShopInfo } from "@/lib/shopify/client";

export type Check = { ok: boolean; detail: string };
export type MailboxTest = { fromEmail: string; imap: Check; smtp: Check };
export type TestResult = { shopify: Check | null; mailboxes: MailboxTest[] };

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Promise mit hartem Timeout absichern (hängende Logins bei falschem Host). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms / 1000}s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

type MailboxRow = typeof schema.shopMailboxes.$inferSelect;

async function testImap(mb: MailboxRow): Promise<Check> {
  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: true,
    auth: { user: mb.imapUser, pass: decrypt(mb.imapPasswordEnc) },
    logger: false,
  });
  try {
    await withTimeout(client.connect(), 15000);
    await client.logout();
    return { ok: true, detail: "IMAP-Login OK" };
  } catch (e) {
    try { client.close(); } catch { /* egal */ }
    return { ok: false, detail: msg(e) };
  }
}

async function testSmtp(mb: MailboxRow): Promise<Check> {
  const transport = nodemailer.createTransport({
    host: mb.smtpHost,
    port: mb.smtpPort,
    secure: mb.smtpPort === 465,
    auth: { user: mb.smtpUser, pass: decrypt(mb.smtpPasswordEnc) },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  try {
    await withTimeout(transport.verify(), 15000);
    return { ok: true, detail: "SMTP-Login OK" };
  } catch (e) {
    return { ok: false, detail: msg(e) };
  } finally {
    transport.close();
  }
}

/** Verbindung eines Shops prüfen: Shopify-Shop-Info + je Postfach IMAP- und SMTP-Login. */
export async function testConnection(shopId: string): Promise<TestResult> {
  await requireShopsEdit();

  let shopify: Check | null = null;
  const creds = await loadShopifyCreds(shopId);
  if (creds) {
    try {
      const info = await withTimeout(getShopInfo(creds), 15000);
      shopify = { ok: true, detail: `Verbunden: ${info.name} (${info.domain})` };
    } catch (e) {
      shopify = { ok: false, detail: msg(e) };
    }
  }

  const mbs = await db
    .select()
    .from(schema.shopMailboxes)
    .where(eq(schema.shopMailboxes.shopId, shopId))
    .orderBy(schema.shopMailboxes.fromEmail);

  const mailboxes: MailboxTest[] = [];
  for (const mb of mbs) {
    const [imap, smtp] = await Promise.all([testImap(mb), testSmtp(mb)]);
    mailboxes.push({ fromEmail: mb.fromEmail, imap, smtp });
  }

  return { shopify, mailboxes };
}
