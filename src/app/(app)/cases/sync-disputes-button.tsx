"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncAllDisputes } from "@/server/actions/disputes";

export function SyncDisputesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="srcrow">
      <button
        className="btnlink"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const r = await syncAllDisputes();
            setMsg(
              `${r.count} Fälle aus ${r.shops} Shop(s)` +
                (r.errors.length ? ` · Fehler: ${r.errors.join("; ")}` : ""),
            );
            router.refresh();
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Lädt…" : "Disputes aktualisieren"}
      </button>
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}
