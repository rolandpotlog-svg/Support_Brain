"use client";
// Gemeinsames PayPal-Konto: Fall per Klick dem richtigen Shop zuordnen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { movePaypalCase } from "@/server/actions/paypal";

export function MoveShop({ caseId, current, others }: { caseId: string; current: string; others: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!others.length) return null;
  return (
    <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
      Shop: <strong style={{ color: "var(--text)" }}>{current}</strong> · gemeinsames PayPal-Konto. Falscher Shop?{" "}
      {others.map((o) => (
        <button
          key={o.id}
          disabled={busy}
          style={{ marginLeft: 6 }}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            const r = await movePaypalCase(caseId, o.id);
            setBusy(false);
            if (!r.ok) return setErr(r.error ?? "Fehler");
            router.refresh();
          }}
        >
          {busy ? "Verschiebt…" : `→ zu ${o.name}`}
        </button>
      ))}
      {err && <span className="error" style={{ marginLeft: 8 }}>{err}</span>}
    </p>
  );
}
