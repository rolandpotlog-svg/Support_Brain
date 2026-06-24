"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateClaimStatus, deleteClaim } from "@/server/actions/claims";
import { CLAIM_STATUSES, CLAIM_STATUS_LABEL } from "@/lib/claims";

export function ClaimActions({
  claimId,
  status,
  creditCents,
}: {
  claimId: string;
  status: string;
  creditCents: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [credit, setCredit] = useState((creditCents / 100).toFixed(2));

  async function setStatus(next: string) {
    setBusy(true);
    try {
      await updateClaimStatus(claimId, next, next === "gutschrift" ? Number(credit.replace(",", ".")) || 0 : undefined);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveCredit() {
    setBusy(true);
    try {
      await updateClaimStatus(claimId, "gutschrift", Number(credit.replace(",", ".")) || 0);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Reklamation wirklich löschen?")) return;
    setBusy(true);
    try {
      await deleteClaim(claimId);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)} className="shopswitch" style={{ padding: "4px 8px" }}>
        {CLAIM_STATUSES.map((s) => (
          <option key={s} value={s}>{CLAIM_STATUS_LABEL[s]}</option>
        ))}
      </select>
      {status === "gutschrift" && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input value={credit} onChange={(e) => setCredit(e.target.value)} onBlur={saveCredit} inputMode="decimal"
            style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", textAlign: "right" }} />
          € Gutschrift
        </span>
      )}
      <button className="btnlink" disabled={busy} onClick={remove} title="Löschen" style={{ color: "var(--danger, #e5634d)" }}>✕</button>
    </div>
  );
}
