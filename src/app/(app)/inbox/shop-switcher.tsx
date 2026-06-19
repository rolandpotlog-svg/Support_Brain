"use client";
import { setActiveShop } from "@/server/actions/inbox";

type Shop = { id: string; name: string };

export function ShopSwitcher({
  shops,
  activeId,
  redirectTo = "/inbox",
}: {
  shops: Shop[];
  activeId: string;
  redirectTo?: string;
}) {
  const active = shops.find((s) => s.id === activeId);
  // Nur ein Shop -> kein Umschalter nötig, nur Anzeige.
  if (shops.length <= 1) {
    return <div className="shopcur" title="Aktiver Shop">{active?.name ?? "—"}</div>;
  }
  return (
    <select
      className="shopswitch"
      value={activeId}
      onChange={(e) => setActiveShop(e.target.value, redirectTo)}
      aria-label="Aktiven Shop wählen"
    >
      {shops.map((s) => (
        <option key={s.id} value={s.id}>{s.name}</option>
      ))}
    </select>
  );
}
