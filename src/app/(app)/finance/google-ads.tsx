"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveGoogleAds, pullGoogleSpend } from "@/server/actions/finance";

type View = { configured: boolean; customerId: string; loginCustomerId: string; clientId: string };

const inp: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--panel-2)", color: "var(--text)", fontSize: 13, width: 240,
};

export function GoogleAdsConnector({ shopId, cfg, since, until }: { shopId: string; cfg: View; since: string; until: string }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(cfg.customerId);
  const [loginCustomerId, setLoginCustomerId] = useState(cfg.loginCustomerId);
  const [clientId, setClientId] = useState(cfg.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [developerToken, setDeveloperToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [s, setS] = useState(since);
  const [u, setU] = useState(until);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await saveGoogleAds(shopId, { customerId, loginCustomerId, clientId, clientSecret, developerToken, refreshToken });
      setMsg("Verbunden ✓");
      setClientSecret(""); setDeveloperToken(""); setRefreshToken("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function pull() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await pullGoogleSpend(shopId, s, u);
      setMsg(`${(r.totalCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} € über ${r.weeks} Woche(n) übernommen`);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const ph = (label: string) => (cfg.configured ? `${label} (leer = behalten)` : label);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input style={inp} value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Kunden-ID (10-stellig)" />
        <input style={inp} value={loginCustomerId} onChange={(e) => setLoginCustomerId(e.target.value)} placeholder="Manager-/MCC-ID (optional)" />
        <input style={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="OAuth Client-ID" />
        <input style={inp} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={ph("OAuth Client-Secret")} />
        <input style={inp} type="password" value={developerToken} onChange={(e) => setDeveloperToken(e.target.value)} placeholder={ph("Developer-Token")} />
        <input style={inp} type="password" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} placeholder={ph("Refresh-Token")} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
        <button className="btnlink" disabled={busy} onClick={save}>Verbinden / Speichern</button>
        {cfg.configured && (
          <>
            <span className="ok-text" style={{ fontSize: 12 }}>✓ verbunden</span>
            <span className="muted" style={{ fontSize: 13 }}>· Zeitraum:</span>
            <input style={{ ...inp, width: "auto" }} type="date" value={s} onChange={(e) => setS(e.target.value)} />
            <span className="muted">bis</span>
            <input style={{ ...inp, width: "auto" }} type="date" value={u} onChange={(e) => setU(e.target.value)} />
            <button className="btnlink primary" disabled={busy} onClick={pull}>Werbekosten holen</button>
          </>
        )}
      </div>
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
      {err && <div className="formerror" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}
