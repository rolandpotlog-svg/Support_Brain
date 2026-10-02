// Aktiver Shop = genau ein Shop im Fokus. Persistiert in einem Cookie,
// damit der Kontext über alle Klicks (Ordner/Tickets) erhalten bleibt.
// Reiner Server-Helfer (RSC) — die Umschalt-Action liegt in actions/inbox.ts.
import { cookies } from "next/headers";

export const ACTIVE_SHOP_COOKIE = "sb_active_shop";

/** Aktiven Shop ermitteln: Cookie, sofern zugänglich; sonst ein fester Standard-Shop (kleinste ID). */
export const ACTIVE_SHOP_COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 180 };

export async function getActiveShopId(accessibleIds: string[]): Promise<string | null> {
  if (accessibleIds.length === 0) return null;
  const store = await cookies();
  const fromCookie = store.get(ACTIVE_SHOP_COOKIE)?.value;
  if (fromCookie && accessibleIds.includes(fromCookie)) return fromCookie;
  // Ohne Cookie IMMER derselbe Shop — unabhängig davon, in welcher Reihenfolge die aufrufende Seite ihre
  // Shops geladen hat. Sonst zeigt die Shop-Leiste einen anderen Shop als der Seiteninhalt.
  return [...accessibleIds].sort()[0];
}
