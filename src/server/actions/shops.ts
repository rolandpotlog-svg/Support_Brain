"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireBrandCap, requireOwner } from "@/server/access";
import { encrypt } from "@/lib/mailbox/crypto";

export type MailboxInput = {
  id?: string; // vorhanden = bestehendes Postfach aktualisieren
  delete?: boolean; // markiert zum Entfernen
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string; // leer = bestehendes behalten (nur bei Update)
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string; // leer = bestehendes behalten (nur bei Update)
  fromEmail: string;
  fromName: string;
};

export type ShopInput = {
  id?: string; // vorhanden = bearbeiten, sonst neu
  name: string;
  active: boolean;
  weeklyReportEnabled: boolean;
  weeklyReportTo: string; // kommagetrennte Empfänger
  autoTag: boolean; // neue Tickets automatisch taggen
  shopifyDomain: string; // leer = Shopify trennen
  shopifyClientId: string; // Client-Credentials-Grant (primär)
  shopifyClientSecret: string; // leer = bestehendes behalten
  shopifyToken: string; // Legacy shpat_-Token (Fallback); leer = behalten
  mailboxes: MailboxInput[];
};

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "shop"
  );
}

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/.\s]+$/, ""); // abschließende Slashes, Punkte, Leerzeichen entfernen
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hit = await db.query.shops.findFirst({ where: eq(schema.shops.slug, candidate) });
    if (!hit || hit.id === exceptId) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

/** Ein Postfach-Eingabe ist "leer" (vom Nutzer hinzugefügt, aber nicht ausgefüllt). */
function isBlankMailbox(m: MailboxInput): boolean {
  return !m.fromEmail.trim() && !m.imapHost.trim() && !m.smtpHost.trim();
}

/** Shop anlegen oder bearbeiten — inkl. Shopify-Zugang und mehrerer Postfächer. */
export async function saveShop(input: ShopInput): Promise<{ id: string }> {
  // Neuer Brand anlegen: nur Owner. Bestehenden bearbeiten: Settings-Recht auf diesem Brand.
  if (input.id) await requireBrandCap(input.id, "settings");
  else await requireOwner();
  const name = input.name.trim();
  if (!name) throw new Error("Anzeigename nötig");
  const weeklyReportTo = input.weeklyReportTo.trim() || null;

  const shopId = await db.transaction(async (tx) => {
    // --- Shop-Stammdaten ---
    let id = input.id;
    if (id) {
      await tx
        .update(schema.shops)
        .set({
          name,
          active: input.active,
          weeklyReportEnabled: input.weeklyReportEnabled,
          weeklyReportTo,
          autoTag: input.autoTag,
        })
        .where(eq(schema.shops.id, id));
    } else {
      const slug = await uniqueSlug(slugify(name));
      const [created] = await tx
        .insert(schema.shops)
        .values({
          slug,
          name,
          active: input.active,
          weeklyReportEnabled: input.weeklyReportEnabled,
          weeklyReportTo,
          autoTag: input.autoTag,
        })
        .returning({ id: schema.shops.id });
      id = created.id;
    }

    // --- Shopify-Zugang ---
    const domain = cleanDomain(input.shopifyDomain);
    const clientId = input.shopifyClientId.trim();
    const clientSecret = input.shopifyClientSecret.trim();
    const legacyToken = input.shopifyToken.trim();
    const existingShopify = await tx.query.shopShopify.findFirst({
      where: eq(schema.shopShopify.shopId, id),
    });

    const upsertShopify = (vals: Omit<typeof schema.shopShopify.$inferInsert, "shopId">) =>
      tx
        .insert(schema.shopShopify)
        .values({ shopId: id, ...vals })
        .onConflictDoUpdate({
          target: schema.shopShopify.shopId,
          set: { ...vals, updatedAt: new Date() },
        });

    if (!domain) {
      if (existingShopify) await tx.delete(schema.shopShopify).where(eq(schema.shopShopify.shopId, id));
    } else if (clientId) {
      // Client-Credentials-Grant (Dev-Dashboard-App)
      const clientSecretEnc = clientSecret ? encrypt(clientSecret) : existingShopify?.clientSecretEnc ?? null;
      if (!clientSecretEnc) throw new Error("Client Secret nötig");
      await upsertShopify({
        storeDomain: domain,
        clientId,
        clientSecretEnc,
        adminTokenEnc: null,
        tokenExpiresAt: null,
      });
    } else if (legacyToken) {
      // Legacy shpat_-Token
      await upsertShopify({
        storeDomain: domain,
        adminTokenEnc: encrypt(legacyToken),
        clientId: null,
        clientSecretEnc: null,
        tokenExpiresAt: null,
      });
    } else if (existingShopify) {
      // Nur Domain geändert -> Modus/Creds behalten, Token-Cache invalidieren.
      await tx
        .update(schema.shopShopify)
        .set({ storeDomain: domain, tokenExpiresAt: null, updatedAt: new Date() })
        .where(eq(schema.shopShopify.shopId, id));
    } else {
      throw new Error("Bitte Client-ID + Client Secret angeben (oder einen Legacy-Token).");
    }

    // --- Postfächer (mehrere) ---
    const existing = await tx
      .select()
      .from(schema.shopMailboxes)
      .where(eq(schema.shopMailboxes.shopId, id));
    const existingById = new Map(existing.map((m) => [m.id, m]));

    for (const mb of input.mailboxes) {
      if (mb.delete) {
        if (mb.id) await tx.delete(schema.shopMailboxes).where(eq(schema.shopMailboxes.id, mb.id));
        continue;
      }
      if (isBlankMailbox(mb)) continue;

      const fromEmail = mb.fromEmail.trim();
      if (!fromEmail) throw new Error("Postfach: Absender-E-Mail nötig");

      if (mb.id && existingById.has(mb.id)) {
        const prev = existingById.get(mb.id)!;
        await tx
          .update(schema.shopMailboxes)
          .set({
            imapHost: mb.imapHost.trim(),
            imapPort: mb.imapPort,
            imapUser: mb.imapUser.trim(),
            imapPasswordEnc: mb.imapPassword ? encrypt(mb.imapPassword) : prev.imapPasswordEnc,
            smtpHost: mb.smtpHost.trim(),
            smtpPort: mb.smtpPort,
            smtpUser: mb.smtpUser.trim(),
            smtpPasswordEnc: mb.smtpPassword ? encrypt(mb.smtpPassword) : prev.smtpPasswordEnc,
            fromEmail,
            fromName: mb.fromName.trim() || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.shopMailboxes.id, mb.id));
      } else {
        if (!mb.imapHost.trim() || !mb.smtpHost.trim()) {
          throw new Error(`Postfach ${fromEmail}: IMAP- und SMTP-Server nötig`);
        }
        if (!mb.imapPassword || !mb.smtpPassword) {
          throw new Error(`Postfach ${fromEmail}: IMAP- und SMTP-Passwort nötig`);
        }
        await tx.insert(schema.shopMailboxes).values({
          shopId: id,
          imapHost: mb.imapHost.trim(),
          imapPort: mb.imapPort,
          imapUser: mb.imapUser.trim(),
          imapPasswordEnc: encrypt(mb.imapPassword),
          smtpHost: mb.smtpHost.trim(),
          smtpPort: mb.smtpPort,
          smtpUser: mb.smtpUser.trim(),
          smtpPasswordEnc: encrypt(mb.smtpPassword),
          fromEmail,
          fromName: mb.fromName.trim() || null,
        });
      }
    }

    return id;
  });

  revalidatePath("/admin/shops");
  revalidatePath(`/admin/shops/${shopId}`);
  revalidatePath("/inbox");
  return { id: shopId };
}

/** Schnell aktiv/inaktiv schalten (Übersicht). */
export async function setShopActive(shopId: string, active: boolean) {
  await requireBrandCap(shopId, "settings");
  await db.update(schema.shops).set({ active }).where(eq(schema.shops.id, shopId));
  revalidatePath("/admin/shops");
  revalidatePath("/inbox");
}
