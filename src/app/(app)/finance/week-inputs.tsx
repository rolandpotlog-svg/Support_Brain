"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWeekInputs } from "@/server/actions/finance";
import { CHANNELS, CHANNEL_LABEL } from "@/lib/finance/channels";

type WeekVals = { weekStart: string; label: string; values: Record<string, number> };

export function WeekInputs({ shopId, weeks }: { shopId: string; weeks: WeekVals[] }) {
  const router = useRouter();
  const [wk, setWk] = useState(weeks[0]?.weekStart ?? "");
  const [vals, setVals] = useState<Record<string, number>>(weeks[0]?.values ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (weeks.length === 0) {
    return <p className="muted" style={{ margin: 0 }}>Noch keine Wochen — zuerst Shopify-Daten ziehen.</p>;
  }

  function pick(weekStart: string) {
    setWk(weekStart);
    setVals(weeks.find((w) => w.weekStart === weekStart)?.values ?? {});
    setMsg(null);
  }
  const set = (k: string, v: string) => setVals({ ...vals, [k]: Number(v) || 0 });
  const num = (k: string) => (
    <input type="number" step="0.01" value={vals[k] ?? 0} onChange={(e) => set(k, e.target.value)} style={{ maxWidth: 130 }} />
  );

  return (
    <div>
      <label className="field" style={{ maxWidth: 220 }}>
        <span className="fieldlabel">Woche</span>
        <select value={wk} onChange={(e) => pick(e.target.value)}>
          {weeks.map((w) => <option key={w.weekStart} value={w.weekStart}>{w.label} · {w.weekStart}</option>)}
        </select>
      </label>

      <div className="grid2" style={{ marginTop: 12 }}>
        {CHANNELS.map((c) => (
          <label className="field" key={c}><span className="fieldlabel">{CHANNEL_LABEL[c]} (€)</span>{num(c)}</label>
        ))}
        <label className="field"><span className="fieldlabel">Fixkosten (€)</span>{num("fix")}</label>
        <label className="field"><span className="fieldlabel">Variable Kosten (€)</span>{num("var")}</label>
      </div>

      <div className="srcrow" style={{ marginTop: 12, alignItems: "center" }}>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setMsg(null);
            try {
              const marketing = Object.fromEntries(CHANNELS.map((c) => [c, vals[c] ?? 0]));
              await saveWeekInputs(shopId, wk, marketing, vals.fix ?? 0, vals.var ?? 0);
              setMsg("Gespeichert.");
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Speichert…" : "Speichern"}
        </button>
        {msg && <span className="muted">{msg}</span>}
        {error && <span className="formerror">{error}</span>}
      </div>
    </div>
  );
}
