"use server";
import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireOwner } from "@/server/access";
import { hashPassword } from "@/lib/password";
import { htmlToPlainText } from "@/lib/mailbox/html-text";
import { applyBrandDefaults } from "@/server/seed-defaults";

const ROLES = ["founder", "admin", "mitarbeiter", "gast"] as const;
function cleanRole(r: string): (typeof ROLES)[number] {
  return (ROLES as readonly string[]).includes(r) ? (r as (typeof ROLES)[number]) : "mitarbeiter";
}

/** Sicherstellen, dass nach einer Änderung noch ein aktiver Owner existiert. */
async function assertOwnerRemains(exceptUserId: string) {
  const others = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.role, "owner"), eq(schema.users.active, true), ne(schema.users.id, exceptUserId)));
  if (others.length === 0) throw new Error("Das ist der einzige aktive Owner — Änderung nicht möglich.");
}

export async function createUser(formData: FormData) {
  await requireOwner();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  const password = String(formData.get("password") ?? "");
  const isOwner = formData.get("isOwner") === "on";
  if (!email || !password) throw new Error("E-Mail und Passwort nötig");
  await db
    .insert(schema.users)
    .values({ email, name, role: isOwner ? "owner" : "member", passwordHash: hashPassword(password) });
  revalidatePath("/admin");
}

export async function setUserActive(formData: FormData) {
  await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const active = formData.get("active") === "on";
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) throw new Error("Nutzer nicht gefunden");
  if (target.role === "owner" && !active) await assertOwnerRemains(userId);
  await db.update(schema.users).set({ active }).where(eq(schema.users.id, userId));
  revalidatePath("/admin");
}

export async function setUserOwner(formData: FormData) {
  await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const makeOwner = formData.get("isOwner") === "on";
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) throw new Error("Nutzer nicht gefunden");
  if (target.role === "owner" && !makeOwner) await assertOwnerRemains(userId);
  await db.update(schema.users).set({ role: makeOwner ? "owner" : "member" }).where(eq(schema.users.id, userId));
  revalidatePath("/admin");
}

export async function resetUserPassword(formData: FormData) {
  await requireOwner();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId || !password) throw new Error("Nutzer und neues Passwort nötig");
  await db.update(schema.users).set({ passwordHash: hashPassword(password) }).where(eq(schema.users.id, userId));
  revalidatePath("/admin");
}

/** Membership (Rolle) eines Nutzers auf einem Brand anlegen/ändern. */
export async function saveMembership(userId: string, shopId: string, role: string) {
  await requireOwner();
  if (!userId || !shopId) throw new Error("Nutzer und Brand nötig");
  const r = cleanRole(role);
  await db
    .insert(schema.userShops)
    .values({ userId, shopId, role: r })
    .onConflictDoUpdate({
      target: [schema.userShops.userId, schema.userShops.shopId],
      set: { role: r },
    });
  revalidatePath("/admin");
}

export async function removeMembership(userId: string, shopId: string) {
  await requireOwner();
  await db
    .delete(schema.userShops)
    .where(and(eq(schema.userShops.userId, userId), eq(schema.userShops.shopId, shopId)));
  revalidatePath("/admin");
}

/** Wartung: Speicherplatz freigeben (Owner). Entfernt gespeicherte Anhänge + rohes HTML aus der DB. */
export async function freeSpaceNow(): Promise<{ before: string; after: string; attachments: number; html: number }> {
  await requireOwner();

  const sizeOf = async (): Promise<string> => {
    const r = await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((r as any)?.rows ?? r)[0]?.s ?? "?";
  };
  const before = await sizeOf();

  // 1) Anhänge sofort freigeben (bleiben im Postfach erhalten).
  const cntRes = await db.execute(sql`SELECT count(*)::int AS n FROM message_attachment`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attachments = Number(((cntRes as any)?.rows ?? cntRes)[0]?.n ?? 0);
  await db.execute(sql`TRUNCATE TABLE message_attachment`);

  // 2) Klartext aus HTML retten, dann HTML löschen.
  const missing = await db
    .select({ id: schema.messages.id, bodyHtml: schema.messages.bodyHtml })
    .from(schema.messages)
    .where(and(isNotNull(schema.messages.bodyHtml), or(isNull(schema.messages.bodyText), eq(schema.messages.bodyText, ""))));
  for (const m of missing) {
    if (m.bodyHtml) await db.update(schema.messages).set({ bodyText: htmlToPlainText(m.bodyHtml) }).where(eq(schema.messages.id, m.id));
  }
  const htmlRes = await db.execute(sql`UPDATE messages SET body_html = NULL WHERE body_html IS NOT NULL`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = Number((htmlRes as any)?.rowCount ?? 0);

  // 3) Platz an Render zurückgeben (best effort).
  try {
    await db.execute(sql`VACUUM FULL message_attachment`);
    await db.execute(sql`VACUUM FULL messages`);
  } catch {
    /* kein Platz für VACUUM FULL -> Schritt 1+2 haben schon geholfen */
  }

  revalidatePath("/admin");
  return { before, after: await sizeOf(), attachments, html };
}

/** Standard-KI-Profil + Schnellantworten für einen Brand (neu) laden (Owner). */
export async function loadBrandDefaults(shopId: string): Promise<{ brand: string; set: string; replies: number }> {
  await requireOwner();
  const r = await applyBrandDefaults(shopId);
  revalidatePath(`/admin/shops/${shopId}`);
  return r;
}
