"use client";
// PayPal-Zugang je Shop (REST-App). Secret wird verschlüsselt gespeichert; leer lassen = behalten.
import { useState } from "react";
import { savePaypalAccess, testPaypalAccess } from "@/server/actions/paypal";

export function PaypalAccess({
  shopId,
  initial,
}: {
  shopId: string;
  initial: { clientId: string; mode: string; hasSecret: boolean; lastSyncAt: string | null; lastError: string | null } | null;
}) {
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [mode, setMode] = useState<"sandbox" | "live">(initial?.mode === "live" ? "live" : "sandbox");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    initial?.lastError ? { ok: false, text: `Letzter Abruf: ${initial.lastError}` } : null,
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await savePaypalAccess(shopId, { clientId, clientSecret: secret, mode });
      if (!r.ok) return setMsg({ ok: false, text: r.error ?? "Fehler" });
      setSecret("");
      if (!clientId.trim()) return setMsg({ ok: true, text: "PayPal-Zugang entfernt." });
      const t = await testPaypalAccess(shopId);
      setMsg({ ok: t.ok, text: t.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>PayPal (Käuferschutzfälle)</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        REST-App aus developer.paypal.com (mit dem PayPal-Geschäftskonto dieses Shops). Das Tool liest die Fälle, ordnet sie Bestellung und Ticket zu und bereitet die Antwort vor. Eingereicht wird nur nach Freigabe.
      </p>
      <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input id="pp-client" name="pp-client-id" autoComplete="off" spellCheck={false} placeholder="Client-ID" value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ flex: 2, minWidth: 220 }} />
        <input id="pp-secret" name="pp-client-secret" type="password" autoComplete="new-password" data-1p-ignore data-lpignore="true" placeholder={initial?.hasSecret ? "Secret (leer = behalten)" : "Client Secret"} value={secret} onChange={(e) => setSecret(e.target.value)} style={{ flex: 2, minWidth: 220 }} />
        <select id="pp-mode" value={mode} onChange={(e) => setMode(e.target.value as "sandbox" | "live")} style={{ maxWidth: 170 }}>
          <option value="sandbox">Sandbox (Test)</option>
          <option value="live">Live</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Prüft…" : "Speichern & testen"}</button>
        {initial?.lastSyncAt && <span className="muted" style={{ fontSize: 12 }}>zuletzt abgerufen: {new Date(initial.lastSyncAt).toLocaleString("de-DE")}</span>}
        {msg && <span className={msg.ok ? "ok-text" : "error"} style={{ fontSize: 13 }}>{msg.text}</span>}
      </div>
    </section>
  );
}
