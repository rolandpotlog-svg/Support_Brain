"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireOwner } from "@/server/access";
import { hashPassword } from "@/lib/password";

const ROLES = ["founder", "admin", "mitarbeiter", "gast"] as const;
function cleanRole(r: string): (typeof ROLES)[number] {
  return (ROLES as readonly string[]).includes(r) ? (r as (typeof ROLES)[number]) : "mitarbeiter";
}
function financeAllowed(role: string, want: boolean): boolean {
  return want && (role === "founder" || role === "admin");
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

/** Membership (Rolle + Finance) eines Nutzers auf einem Brand anlegen/ändern. */
export async function saveMembership(userId: string, shopId: string, role: string, finance: boolean) {
  await requireOwner();
  if (!userId || !shopId) throw new Error("Nutzer und Brand nötig");
  const r = cleanRole(role);
  const financeAccess = financeAllowed(r, finance); // Invariante: Finance nur founder/admin
  await db
    .insert(schema.userShops)
    .values({ userId, shopId, role: r, financeAccess })
    .onConflictDoUpdate({
      target: [schema.userShops.userId, schema.userShops.shopId],
      set: { role: r, financeAccess },
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
