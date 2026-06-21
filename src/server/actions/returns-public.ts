"use server";
// Öffentliche Portal-Aktionen (KEIN Login). Jede Aktion verifiziert Bestellung+E-Mail
// erneut über Shopify; Preise kommen serverseitig aus Shopify (nicht vom Client).
import { buildOffer, createReturnCase, econFromSettings, getSettings, loadPortalShop, verifyAndLoadOrder, type Offer, type PortalItem } from "@/server/returns";

export type LookupResult =
  | {
      ok: true;
      shopName: string;
      currency: string;
      accentColor: string;
      reasons: { id: string; label: string }[];
      items: PortalItem[];
    }
  | { ok: false; error: string };

const GENERIC = "Bestellung nicht gefunden. Prüfe Bestellnummer und E-Mail.";

export async function portalLookup(slug: string, orderName: string, email: string): Promise<LookupResult> {
  const shop = await loadPortalShop(slug);
  if (!shop) return { ok: false, error: "Portal nicht verfügbar." };
  if (!orderName.trim() || !email.trim()) return { ok: false, error: "Bitte Bestellnummer und E-Mail eingeben." };
  try {
    const res = await verifyAndLoadOrder(shop.shopId, orderName, email);
    if (!res) return { ok: false, error: GENERIC };
    return {
      ok: true,
      shopName: shop.shopName,
      currency: shop.currency,
      accentColor: shop.accentColor,
      reasons: shop.reasons.map((r) => ({ id: r.id, label: r.label })),
      items: res.items,
    };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export type OfferResult = { ok: true; offer: Offer } | { ok: false; error: string };

export async function portalOffer(
  slug: string,
  orderName: string,
  email: string,
  reasonId: string,
  lineIndex: number,
  qty: number,
  step: number,
): Promise<OfferResult> {
  const shop = await loadPortalShop(slug);
  if (!shop) return { ok: false, error: "Portal nicht verfügbar." };
  const reason = shop.reasons.find((r) => r.id === reasonId);
  if (!reason) return { ok: false, error: "Grund ungültig." };
  const settings = await getSettings(shop.shopId);
  if (!settings) return { ok: false, error: "Portal nicht verfügbar." };
  try {
    const res = await verifyAndLoadOrder(shop.shopId, orderName, email);
    if (!res) return { ok: false, error: GENERIC };
    const item = res.items[lineIndex];
    if (!item) return { ok: false, error: "Artikel ungültig." };
    const q = Math.max(1, Math.min(qty, item.quantity));
    const offer = buildOffer(reason.routing, item, q, Math.max(0, step), econFromSettings(settings), settings.currency);
    return { ok: true, offer };
  } catch {
    return { ok: false, error: GENERIC };
  }
}

export type AcceptResult = { ok: true; number: number } | { ok: false; error: string };

export async function portalAccept(
  slug: string,
  orderName: string,
  email: string,
  reasonId: string,
  lineIndex: number,
  qty: number,
  step: number,
  acceptVoucher: boolean,
): Promise<AcceptResult> {
  const shop = await loadPortalShop(slug);
  if (!shop) return { ok: false, error: "Portal nicht verfügbar." };
  const reason = shop.reasons.find((r) => r.id === reasonId);
  if (!reason) return { ok: false, error: "Grund ungültig." };
  const settings = await getSettings(shop.shopId);
  if (!settings) return { ok: false, error: "Portal nicht verfügbar." };
  try {
    const res = await verifyAndLoadOrder(shop.shopId, orderName, email);
    if (!res) return { ok: false, error: GENERIC };
    const item = res.items[lineIndex];
    if (!item) return { ok: false, error: "Artikel ungültig." };
    const q = Math.max(1, Math.min(qty, item.quantity));
    const offer = buildOffer(reason.routing, item, q, Math.max(0, step), econFromSettings(settings), settings.currency);
    const { number } = await createReturnCase({
      shopId: shop.shopId,
      settings,
      order: res.order,
      item,
      qty: q,
      reason,
      offer,
      acceptVoucher,
    });
    return { ok: true, number };
  } catch {
    return { ok: false, error: "Konnte nicht abgeschlossen werden. Bitte später erneut versuchen." };
  }
}
