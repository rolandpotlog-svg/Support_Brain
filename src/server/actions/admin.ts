"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireManageUsers } from "@/server/access";
import { hashPassword } from "@/lib/password";

// Shop-/Shopify-/Postfach-Verwaltung liegt in actions/shops.ts (saveShop, setShopActive).

type PermSet = {
  permReports: boolean;
  permCases: boolean;
  permShopsView: boolean;
  permShopsEdit: boolean;
  permReturns: boolean;
  permManageUsers: boolean;
};

function readPerms(fd: FormData): PermSet {
  return {
    permReports: fd.get("permReports") === "on",
    permCases: fd.get("permCases") === "on",
    permShopsView: fd.get("permShopsView") === "on",
    permShopsEdit: fd.get("permShopsEdit") === "on",
    permReturns: fd.get("permReturns") === "on",
    permManageUsers: fd.get("permManageUsers") === "on",
  };
}

export async function createUser(formData: FormData) {
  const actor = await requireManageUsers();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim() || null;
  let role = String(formData.get("role") ?? "member");
  const password = String(formData.get("password") ?? "");
  const shopIds = formData.getAll("shopIds").map(String);
  const perms = readPerms(formData);
  if (!email || !password) throw new Error("E-Mail und Passwort nötig");
  if (role !== "owner" && role !== "member") role = "member";

  // Eskalations-Schutz: Nur ein Owner darf Owner-Rang oder Nutzerverwaltung vergeben.
  if (!actor.isOwner) {
    role = "member";
    perms.permManageUsers = false;
  }

  await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({ email, name, role, passwordHash: hashPassword(password), ...perms })
      .returning({ id: schema.users.id });
    for (const shopId of shopIds) {
      await tx.insert(schema.userShops).values({ userId: u.id, shopId });
    }
  });
  revalidatePath("/admin");
}

export async function updateUser(formData: FormData) {
  const actor = await requireManageUsers();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Nutzer fehlt");
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) throw new Error("Nutzer nicht gefunden");

  let role = String(formData.get("role") ?? "member");
  const active = formData.get("active") === "on";
  const perms = readPerms(formData);
  if (role !== "owner" && role !== "member") role = "member";

  // Nur Owner dürfen Owner bearbeiten bzw. Owner-Rang/Nutzerverwaltung vergeben.
  if (!actor.isOwner) {
    if (target.role === "owner") throw new Error("Nur ein Owner darf einen Owner bearbeiten");
    role = "member";
    perms.permManageUsers = false;
  }

  // Letzten aktiven Owner schützen (nicht herabstufen/deaktivieren).
  if (target.role === "owner" && (role !== "owner" || !active)) {
    const otherOwners = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, "owner"), eq(schema.users.active, true), ne(schema.users.id, userId)));
    if (otherOwners.length === 0) {
      throw new Error("Das ist der einzige aktive Owner — Rolle/Aktiv kann nicht geändert werden.");
    }
  }

  await db.update(schema.users).set({ role, active, ...perms }).where(eq(schema.users.id, userId));
  revalidatePath("/admin");
}

export async function resetUserPassword(formData: FormData) {
  await requireManageUsers();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!userId || !password) throw new Error("Nutzer und neues Passwort nötig");
  await db.update(schema.users).set({ passwordHash: hashPassword(password) }).where(eq(schema.users.id, userId));
  revalidatePath("/admin");
}
