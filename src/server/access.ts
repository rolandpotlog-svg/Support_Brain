import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db, schema } from "@/server/db";

// Effektive Berechtigungen des eingeloggten Nutzers. Owner => alles true.
export type SessionUser = {
  id: string;
  email: string;
  role: "owner" | "member";
  isOwner: boolean;
  canReports: boolean;
  canCases: boolean;
  canShopsView: boolean;
  canShopsEdit: boolean;
  canManageUsers: boolean;
};

/** Eingeloggten Nutzer laden (frisch aus der DB -> Rechte-Änderungen wirken sofort). */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Nicht eingeloggt");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, session.user.id) });
  if (!u || !u.active) throw new Error("Kein Zugriff");
  const isOwner = u.role === "owner";
  return {
    id: u.id,
    email: u.email,
    role: isOwner ? "owner" : "member",
    isOwner,
    canReports: isOwner || u.permReports,
    canCases: isOwner || u.permCases,
    canShopsView: isOwner || u.permShopsView || u.permShopsEdit,
    canShopsEdit: isOwner || u.permShopsEdit,
    canManageUsers: isOwner || u.permManageUsers,
  };
}

async function require(check: (u: SessionUser) => boolean, msg: string): Promise<SessionUser> {
  const u = await requireUser();
  if (!check(u)) throw new Error(msg);
  return u;
}

export const requireOwner = () => require((u) => u.isOwner, "Nur der Owner darf das");
export const requireReports = () => require((u) => u.canReports, "Keine Berechtigung (Auswertung)");
export const requireCases = () => require((u) => u.canCases, "Keine Berechtigung (Fälle)");
export const requireShopsView = () => require((u) => u.canShopsView, "Keine Berechtigung (Shops)");
export const requireShopsEdit = () => require((u) => u.canShopsEdit, "Keine Berechtigung (Shops verwalten)");
export const requireManageUsers = () => require((u) => u.canManageUsers, "Keine Berechtigung (Nutzer)");

/** Sieht der Nutzer Shop-übergreifend (Owner/Shops/Auswertung/Fälle) oder nur zugewiesene? */
function hasGlobalShopView(user: SessionUser): boolean {
  return user.isOwner || user.canShopsView || user.canReports || user.canCases;
}

/** Shop-IDs, die der Nutzer sehen darf. */
export async function accessibleShopIds(user: SessionUser): Promise<string[]> {
  if (hasGlobalShopView(user)) {
    const rows = await db.select({ id: schema.shops.id }).from(schema.shops);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: schema.userShops.shopId })
    .from(schema.userShops)
    .where(eq(schema.userShops.userId, user.id));
  return rows.map((r) => r.id);
}

export async function assertShopAccess(user: SessionUser, shopId: string): Promise<void> {
  if (hasGlobalShopView(user)) return;
  const row = await db.query.userShops.findFirst({
    where: and(eq(schema.userShops.userId, user.id), eq(schema.userShops.shopId, shopId)),
  });
  if (!row) throw new Error("Kein Zugriff auf diesen Shop");
}

export type AssignableUser = { id: string; name: string | null; email: string };

/** Nutzer, denen ein Ticket dieses Shops zugewiesen werden kann: Owner + zugeordnete Mitglieder. */
export async function assignableUsers(shopId: string): Promise<AssignableUser[]> {
  const owners = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.role, "owner"), eq(schema.users.active, true)));

  const members = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
    .from(schema.userShops)
    .innerJoin(schema.users, eq(schema.users.id, schema.userShops.userId))
    .where(and(eq(schema.userShops.shopId, shopId), eq(schema.users.active, true)));

  const byId = new Map<string, AssignableUser>();
  for (const u of [...owners, ...members]) byId.set(u.id, u);
  return [...byId.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
