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
  finance: finance0 = false,
  brands,
}: {
  userId: string;
  shopId?: string;
  shopName?: string;
  role?: string;
  finance?: boolean;
  brands?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const isNew = !shopId;
  const [brand, setBrand] = useState(brands?.[0]?.id ?? "");
  const [role, setRole] = useState(role0);
  const [finance, setFinance] = useState(finance0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const high = role === "founder" || role === "admin"; // Finance nur hier aktivierbar
  const financeChecked = high && finance;
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
        onChange={(e) => {
          const v = e.target.value;
          setRole(v);
          if (v !== "founder" && v !== "admin") setFinance(false);
        }}
      >
        {Object.entries(ROLE_LABEL).map(([k, l]) => (
          <option key={k} value={k}>{l}</option>
        ))}
      </select>
      <label className="chk" title={high ? "" : "Nur für Founder/Admin aktivierbar"} style={{ opacity: high ? 1 : 0.5 }}>
        <input type="checkbox" disabled={!high} checked={financeChecked} onChange={(e) => setFinance(e.target.checked)} />
        Finance
      </label>
      <button className="btnlink primary" disabled={busy || !target} onClick={() => run(() => saveMembership(userId, target, role, financeChecked))}>
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
