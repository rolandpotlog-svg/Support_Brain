import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db, schema } from "@/server/db";

// Globale Identität. role: "owner" (Vollzugriff auf ALLE Brands inkl. Finance) | "member".
export type SessionUser = { id: string; email: string; isOwner: boolean };

export type BrandRole = "founder" | "admin" | "mitarbeiter" | "gast";
export type Cap = "support" | "returns" | "reports" | "cases" | "settings" | "manageUsers";

// Effektive Rechte eines Nutzers AUF EINEM Brand.
export type BrandCaps = {
  role: BrandRole | "owner" | "none";
  access: boolean; // gehört der Nutzer zu diesem Brand (oder Owner)?
  readOnly: boolean; // gast = nur lesen
  support: boolean;
  returns: boolean;
  reports: boolean;
  cases: boolean;
  settings: boolean;
  manageUsers: boolean;
};

const OWNER_CAPS: BrandCaps = {
  role: "owner", access: true, readOnly: false,
  support: true, returns: true, reports: true, cases: true,
  settings: true, manageUsers: true,
};
const NO_CAPS: BrandCaps = {
  role: "none", access: false, readOnly: true,
  support: false, returns: false, reports: false, cases: false,
  settings: false, manageUsers: false,
};

function capsForRole(role: BrandRole): BrandCaps {
  const high = role === "founder" || role === "admin";
  return {
    role,
    access: true,
    readOnly: role === "gast",
    support: true, // alle Rollen dürfen Support zumindest sehen
    returns: role !== "gast",
    reports: high,
    cases: high,
    settings: high,
    manageUsers: high,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Nicht eingeloggt");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, session.user.id) });
  if (!u || !u.active) throw new Error("Kein Zugriff");
  return { id: u.id, email: u.email, isOwner: u.role === "owner" };
}

export async function requireOwner(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isOwner) throw new Error("Nur der Owner darf das");
  return user;
}

/** Effektive Rechte eines Nutzers auf einem Brand. Owner => alles. */
export async function brandAccess(user: SessionUser, shopId: string): Promise<BrandCaps> {
  if (user.isOwner) return OWNER_CAPS;
  const m = await db.query.userShops.findFirst({
    where: and(eq(schema.userShops.userId, user.id), eq(schema.userShops.shopId, shopId)),
  });
  if (!m) return NO_CAPS;
  return capsForRole((m.role as BrandRole) ?? "mitarbeiter");
}

/** Wirft, wenn der Nutzer die Fähigkeit auf diesem Brand nicht hat. */
export async function requireBrandCap(shopId: string, cap: Cap): Promise<{ user: SessionUser; caps: BrandCaps }> {
  const user = await requireUser();
  const caps = await brandAccess(user, shopId);
  if (!caps[cap]) throw new Error("Keine Berechtigung für diesen Bereich/Brand");
  return { user, caps };
}

/** Wie requireBrandCap, blockt zusätzlich Gast-Lesezugriff (Mutationen). */
export async function requireWrite(shopId: string, cap: Cap): Promise<{ user: SessionUser; caps: BrandCaps }> {
  const r = await requireBrandCap(shopId, cap);
  if (r.caps.readOnly) throw new Error("Nur Lesezugriff (Gast)");
  return r;
}

export async function assertShopAccess(user: SessionUser, shopId: string): Promise<void> {
  const caps = await brandAccess(user, shopId);
  if (!caps.access) throw new Error("Kein Zugriff auf diesen Brand");
}

/** Brand-IDs, die der Nutzer sehen darf. Owner => alle. */
export async function accessibleShopIds(user: SessionUser): Promise<string[]> {
  if (user.isOwner) {
    const rows = await db.select({ id: schema.shops.id }).from(schema.shops);
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: schema.userShops.shopId })
    .from(schema.userShops)
    .where(eq(schema.userShops.userId, user.id));
  return rows.map((r) => r.id);
}

export type AssignableUser = { id: string; name: string | null; email: string };

/** Nutzer, denen ein Ticket dieses Brands zugewiesen werden kann: Owner + Mitglieder des Brands. */
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
