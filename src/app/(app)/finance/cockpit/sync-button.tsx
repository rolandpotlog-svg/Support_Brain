"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { syncCockpit } from "@/server/actions/finance";

export function SyncButton({ shopId, since, until }: { shopId: string; since: string; until: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true); setMsg(null);
    try {
      const r = await syncCockpit(shopId, since, until);
      const eur = (c: number) => `${(c / 100).toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
      setMsg(`${r.shopifyCount} Orders · Meta ${eur(r.metaCents)} · Google ${eur(r.googleCents)}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className="btnlink primary" onClick={sync} disabled={busy}>{busy ? "Synchronisiert…" : "🔄 Jetzt synchronisieren"}</button>
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
    </span>
  );
}
