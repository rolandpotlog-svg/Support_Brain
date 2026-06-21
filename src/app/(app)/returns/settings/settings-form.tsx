"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveReasons, saveReturnSettings } from "@/server/actions/returns";
import { ROUTINGS, ROUTING_LABEL, type Routing } from "@/lib/returns/routing";

type Settings = {
  enabled: boolean;
  cogsPct: number;
  returnShippingEuros: number;
  resaleableDefault: boolean;
  voucherBonusPct: number;
  firstOfferPct: number;
  fraudWindowDays: number;
  fraudMaxKeepEuros: number;
  highValueThresholdEuros: number;
  accentColor: string;
};
type Reason = { label: string; routing: string; active: boolean };

export function ReturnsSettingsForm({
  shopId,
  initial,
  reasons: initialReasons,
}: {
  shopId: string;
  slug: string;
  initial: Settings;
  reasons: Reason[];
}) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial);
  const [reasons, setReasons] = useState<Reason[]>(
    initialReasons.length ? initialReasons : [{ label: "Gefällt nicht / Meinung geändert", routing: "keep_refund", active: true }],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  async function save() {
    setBusy(true); setError(null); setMsg(null);
    try {
      await saveReturnSettings({ shopId, ...s });
      await saveReasons(shopId, reasons);
      setMsg("Gespeichert.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, node: React.ReactNode) => (
    <label className="field"><span className="fieldlabel">{label}</span>{node}</label>
  );

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Portal</h2>
        <label className="chk">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          Retouren-Portal aktiv (Kunden können den Link nutzen)
        </label>
        <div className="grid2" style={{ marginTop: 12 }}>
          {field("Akzentfarbe", <input type="color" value={s.accentColor} onChange={(e) => setS({ ...s, accentColor: e.target.value })} style={{ width: 60, height: 34 }} />)}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Ökonomie-Engine</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Bestimmt den max. „Behalten"-Rabatt: <em>Rücksendekosten + (nicht wiederverkäuflich ? COGS : 0)</em>, gedeckelt auf den Artikelpreis.
        </p>
        <div className="grid2">
          {field("COGS (% vom Preis)", <input type="number" value={s.cogsPct} onChange={num("cogsPct")} />)}
          {field("Rücksendekosten (€)", <input type="number" step="0.5" value={s.returnShippingEuros} onChange={num("returnShippingEuros")} />)}
          {field("1. Angebot (% der Obergrenze)", <input type="number" value={s.firstOfferPct} onChange={num("firstOfferPct")} />)}
          {field("Gutschein-Bonus (%)", <input type="number" value={s.voucherBonusPct} onChange={num("voucherBonusPct")} />)}
        </div>
        <label className="chk" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={s.resaleableDefault} onChange={(e) => setS({ ...s, resaleableDefault: e.target.checked })} />
          Artikel standardmäßig wiederverkäuflich (sonst COGS als Verlust einrechnen)
        </label>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Guardrails</h2>
        <div className="grid2">
          {field("Betrugslimit Behalten (€ pro Zeitfenster)", <input type="number" value={s.fraudMaxKeepEuros} onChange={num("fraudMaxKeepEuros")} />)}
          {field("Zeitfenster (Tage)", <input type="number" value={s.fraudWindowDays} onChange={num("fraudWindowDays")} />)}
          {field("Hochwert-Schwelle (€, keine Behalten-Option)", <input type="number" value={s.highValueThresholdEuros} onChange={num("highValueThresholdEuros")} />)}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Rückgabe-Gründe</h2>
        <div className="userlist">
          {reasons.map((r, i) => (
            <div className="userform" key={i}>
              <input
                value={r.label}
                placeholder="Grund"
                onChange={(e) => setReasons(reasons.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                style={{ minWidth: 220 }}
              />
              <select value={r.routing} onChange={(e) => setReasons(reasons.map((x, j) => (j === i ? { ...x, routing: e.target.value } : x)))}>
                {ROUTINGS.map((rt) => <option key={rt} value={rt}>{ROUTING_LABEL[rt as Routing]}</option>)}
              </select>
              <label className="chk">
                <input type="checkbox" checked={r.active} onChange={(e) => setReasons(reasons.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />
                aktiv
              </label>
              <button className="btnlink" type="button" onClick={() => setReasons(reasons.filter((_, j) => j !== i))}>Entfernen</button>
            </div>
          ))}
        </div>
        <button className="btnlink" type="button" style={{ marginTop: 10 }} onClick={() => setReasons([...reasons, { label: "", routing: "keep_refund", active: true }])}>
          + Grund hinzufügen
        </button>
      </section>

      <div className="srcrow" style={{ alignItems: "center" }}>
        <button className="primary" disabled={busy} onClick={save}>{busy ? "Speichert…" : "Speichern"}</button>
        {msg && <span className="muted">{msg}</span>}
        {error && <span className="formerror">{error}</span>}
      </div>
    </>
  );
}
