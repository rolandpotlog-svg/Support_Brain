"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveMetaAds, pullMetaSpend } from "@/server/actions/finance";
import { channelLabel, type Channel } from "@/lib/finance/channels";

type AccView = { channel: string; accountId: string; configured: boolean };

const inp: React.CSSProperties = {
  padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border)",
  background: "var(--panel-2)", color: "var(--text)", fontSize: 13,
};

function ChannelRow({ shopId, acc, since, until, ruleShop }: { shopId: string; acc: AccView; since: string; until: string; ruleShop: boolean }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(acc.accountId);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await saveMetaAds(shopId, acc.channel, accountId, token);
      setMsg(`Verbunden${r.name ? ` · ${r.name}` : ""}`);
      setToken("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function pull() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await pullMetaSpend(shopId, acc.channel, since, until);
      setMsg(`${(r.totalCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} € über ${r.weeks} Woche(n) übernommen`);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ minWidth: 150 }}>{channelLabel(acc.channel as Channel, ruleShop)}</strong>
        <span className={acc.configured ? "ok-text" : "muted"} style={{ fontSize: 12 }}>
          {acc.configured ? "✓ verbunden" : "nicht verbunden"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <input style={{ ...inp, width: 180 }} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Werbekonto-ID (act_…)" />
        <input style={{ ...inp, width: 220 }} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={acc.configured ? "Token (leer = behalten)" : "Access-Token (ads_read)"} />
        <button className="btnlink" disabled={busy} onClick={save}>Speichern</button>
        {acc.configured && <button className="btnlink primary" disabled={busy} onClick={pull}>Werbeausgaben holen</button>}
      </div>
      {msg && <span className="muted" style={{ fontSize: 12 }}>{msg}</span>}
      {err && <div className="formerror" style={{ marginTop: 4 }}>{err}</div>}
    </div>
  );
}

export function MetaAdsConnector({ shopId, accounts, since, until, ruleShop = false }: { shopId: string; accounts: AccView[]; since: string; until: string; ruleShop?: boolean }) {
  const [s, setS] = useState(since);
  const [u, setU] = useState(until);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span className="muted">Zeitraum holen:</span>
        <input style={inp} type="date" value={s} onChange={(e) => setS(e.target.value)} />
        <span className="muted">bis</span>
        <input style={inp} type="date" value={u} onChange={(e) => setU(e.target.value)} />
      </div>
      {accounts.map((a) => <ChannelRow key={a.channel} shopId={shopId} acc={a} since={s} until={u} ruleShop={ruleShop} />)}
    </div>
  );
}
