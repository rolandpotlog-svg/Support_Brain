"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importBlueprint } from "@/server/actions/finance";

export function BlueprintUpload({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("shopId", shopId);
      fd.set("file", file);
      const r = await importBlueprint(fd);
      setMsg(`Blatt „${r.sheet}": Marketing für ${r.marketingWeeks} Woche(n) + ${r.manualWeeks} historische Woche(n) importiert.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <div>
      <label className="btnlink" style={{ cursor: "pointer", display: "inline-flex" }}>
        {busy ? "Importiert…" : "📊 PnL-Blueprint (Excel) importieren"}
        <input
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onFile}
          disabled={busy}
          style={{ display: "none" }}
        />
      </label>
      {msg && <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>{msg}</span>}
      {error && <div className="formerror" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
