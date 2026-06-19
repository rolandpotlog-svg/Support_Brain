import { and, eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { db, schema } from "@/server/db";

export type SessionUser = { id: string; role: "agent" | "admin"; email: string };

/** Liefert den eingeloggten Nutzer oder wirft (für Server Actions / Routen). */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Nicht eingeloggt");
  return {
    id: session.user.id,
    role: session.user.role,
    email: session.user.email ?? "",
  };
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("Admin-Rechte erforderlich");
  return user;
}

/** Shop-IDs, die der Nutzer sehen darf. Admin = alle. */
export async function accessibleShopIds(user: SessionUser): Promise<string[]> {
  if (user.role === "admin") {
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
  if (user.role === "admin") return;
  const row = await db.query.userShops.findFirst({
    where: and(
      eq(schema.userShops.userId, user.id),
      eq(schema.userShops.shopId, shopId),
    ),
  });
  if (!row) throw new Error("Kein Zugriff auf diesen Shop");
}
