"use client";
import { useState } from "react";
import { analyzeComplaints } from "@/server/actions/ai";

export function ComplaintAnalysis({ shopId, days }: { shopId: string; days: number }) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        className="btnlink"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setText(await analyzeComplaints(shopId, days));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Analysiert…" : text ? "Neu analysieren" : "✨ KI-Analyse erstellen"}
      </button>
      {error && <div className="formerror" style={{ marginTop: 10 }}>{error}</div>}
      {text && <pre className="promptview" style={{ marginTop: 12 }}>{text}</pre>}
    </div>
  );
}
