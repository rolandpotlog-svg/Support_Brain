"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { removeMembership, saveMembership } from "@/server/actions/admin";

const ROLE_LABEL: Record<string, string> = {
  founder: "Founder",
  admin: "Admin",
  mitarbeiter: "Mitarbeiter",
  gast: "Gast (nur lesen)",
};

export function MembershipForm({
  userId,
  shopId,
  shopName,
  role: role0 = "mitarbeiter",
  brands,
}: {
  userId: string;
  shopId?: string;
  shopName?: string;
  role?: string;
  brands?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const isNew = !shopId;
  const [brand, setBrand] = useState(brands?.[0]?.id ?? "");
  const [role, setRole] = useState(role0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = shopId ?? brand;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (isNew && (!brands || brands.length === 0)) return null;

  return (
    <div className="userform">
      {isNew ? (
        <select value={brand} onChange={(e) => setBrand(e.target.value)} style={{ minWidth: 130 }}>
          {brands!.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      ) : (
        <span style={{ minWidth: 130, fontWeight: 600 }}>{shopName}</span>
      )}
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
      >
        {Object.entries(ROLE_LABEL).map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      <button className="btnlink primary" disabled={busy || !target} onClick={() => run(() => saveMembership(userId, target, role))}>
        {isNew ? "Hinzufügen" : "Speichern"}
      </button>
      {!isNew && (
        <button className="btnlink" disabled={busy} onClick={() => run(() => removeMembership(userId, shopId!))}>
          Entfernen
        </button>
      )}
      {error && <span className="formerror">{error}</span>}
    </div>
  );
}
