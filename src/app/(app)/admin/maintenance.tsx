"use client";
import { useState } from "react";
import { freeSpaceNow } from "@/server/actions/admin";

export function Maintenance() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        "Speicher freigeben?\n\nGespeicherte Foto-Anhänge werden aus der App entfernt (bleiben in deinem E-Mail-Postfach erhalten) und HTML-Ballast wird aufgeräumt. Das kann eine Minute dauern.",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await freeSpaceNow();
      setRes(`✓ Aufgeräumt: ${r.attachments} Anhänge + ${r.html} HTML-Mails entfernt. Datenbank: ${r.before} → ${r.after}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Falls die Datenbank voll wird: hier per Klick Platz freigeben. Der Worker räumt alte Anhänge zusätzlich automatisch weg.
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "Räumt auf…" : "🧹 Speicher freigeben"}
      </button>
      {res && <p className="ok-text" style={{ marginTop: 8 }}>{res}</p>}
      {err && <p className="formerror" style={{ marginTop: 8 }}>{err}</p>}
    </div>
  );
}
