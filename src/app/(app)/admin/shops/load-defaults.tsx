"use client";
import { useState } from "react";
import { loadBrandDefaults } from "@/server/actions/admin";

export function LoadDefaults({ shopId }: { shopId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        "Standard-KI-Profil und Schnellantworten für diesen Brand (neu) laden?\n\nDas KI-Wissen (Ton, Produktwissen, Deeskalations-Strategie) wird gesetzt und gleichnamige Schnellantworten werden auf den aktuellen Stand gebracht.",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await loadBrandDefaults(shopId);
      setMsg(`✓ ${r.brand}: KI-Profil gesetzt + ${r.replies} Schnellantworten (${r.set}).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: "0 0 14px" }}>
      <div className="cardhead">
        <h3 style={{ margin: 0 }}>KI-Standard laden</h3>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Setzt das bewährte KI-Profil (Ton, Produktwissen, Deeskalations-Strategie für „Gerät funktioniert nicht") und die
        Schnellantworten für diesen Brand. Praktisch nach Updates.
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "Lädt…" : "🔄 Standard-Profil & Vorlagen laden"}
      </button>
      {msg && <p className="ok-text" style={{ marginTop: 8 }}>{msg}</p>}
      {err && <p className="formerror" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
