// Aktiver Shop = genau ein Shop im Fokus. Persistiert in einem Cookie,
// damit der Kontext über alle Klicks (Ordner/Tickets) erhalten bleibt.
// Reiner Server-Helfer (RSC) — die Umschalt-Action liegt in actions/inbox.ts.
import { cookies } from "next/headers";

export const ACTIVE_SHOP_COOKIE = "sb_active_shop";

/** Aktiven Shop ermitteln: Cookie, sofern zugänglich; sonst erster zugänglicher Shop. */
export async function getActiveShopId(accessibleIds: string[]): Promise<string | null> {
  if (accessibleIds.length === 0) return null;
  const store = await cookies();
  const fromCookie = store.get(ACTIVE_SHOP_COOKIE)?.value;
  if (fromCookie && accessibleIds.includes(fromCookie)) return fromCookie;
  return accessibleIds[0];
}
