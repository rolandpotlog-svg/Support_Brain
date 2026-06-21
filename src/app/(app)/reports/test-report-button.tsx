"use client";
import { useState } from "react";
import { sendWeeklyReportNow } from "@/server/actions/ai";

export function TestReportButton({ shopId, days }: { shopId: string; days: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="srcrow" style={{ alignItems: "center" }}>
      <button
        className="btnlink"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setMsg(null);
          try {
            const r = await sendWeeklyReportNow(shopId, days);
            setMsg(`Gesendet an: ${r.to.join(", ")}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sendet… (klassifiziert + versendet)" : "📧 Wochenbericht jetzt senden"}
      </button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      {error && <span className="formerror">{error}</span>}
    </div>
  );
}
