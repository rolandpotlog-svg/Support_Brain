"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ingestFinance } from "@/server/actions/finance";

export function IngestButton({ shopId, defaultUntil }: { shopId: string; defaultUntil: string }) {
  const router = useRouter();
  const [since, setSince] = useState("2025-12-29");
  const [until, setUntil] = useState(defaultUntil);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="srcrow" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
      <label className="field"><span className="fieldlabel">Von</span><input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label className="field"><span className="fieldlabel">Bis</span><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <button
        className="btnlink primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setMsg(null);
          try {
            const r = await ingestFinance(shopId, since, until);
            setMsg(`${r.count} Bestellungen geladen${r.unmapped ? ` · ⚠ ${r.unmapped} mit unbekanntem Produkt` : ""}.`);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Lädt aus Shopify…" : "Shopify-Daten ziehen"}
      </button>
      {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      {error && <span className="formerror">{error}</span>}
    </div>
  );
}
