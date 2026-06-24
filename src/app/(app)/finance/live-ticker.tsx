"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ingestFinance } from "@/server/actions/finance";

const INTERVAL_MS = 90_000; // alle 90s Shopify der laufenden Woche nachziehen

export function LiveTicker({ shopId, weekStart }: { shopId: string; weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  const pull = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await ingestFinance(shopId, weekStart, today);
      setLast(new Date().toLocaleTimeString("de-DE"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [shopId, weekStart, router]);

  // Beim Öffnen einmal ziehen + danach im Intervall (nur wenn Tab sichtbar).
  useEffect(() => {
    void pull();
    if (!auto) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void pull();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto, pull]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <span className={busy ? "livedot livedot-busy" : "livedot"} />
        {busy ? "aktualisiert…" : last ? `live · zuletzt ${last}` : "live"}
      </span>
      <button type="button" className="btnlink" onClick={() => void pull()} disabled={busy}>
        🔄 Jetzt aktualisieren
      </button>
      <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
        Auto (90 s)
      </label>
      {error && <span className="formerror" style={{ margin: 0 }}>{error}</span>}
    </div>
  );
}
