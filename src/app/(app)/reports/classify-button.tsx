"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { classifyTickets } from "@/server/actions/ai";

export function ClassifyButton({ shopId, days, pending }: { shopId: string; days: number; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="srcrow" style={{ alignItems: "center" }}>
      <button
        className="btnlink primary"
        disabled={busy || pending === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setMsg(null);
          try {
            const r = await classifyTickets(shopId, days);
            setMsg(`${r.classified} klassifiziert${r.remaining > 0 ? `, ${r.remaining} übrig (nochmal klicken)` : ""}.`);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Klassifiziert…" : pending === 0 ? "Alles klassifiziert" : `✨ ${pending} Tickets klassifizieren`}
      </button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      {error && <span className="formerror">{error}</span>}
    </div>
  );
}
