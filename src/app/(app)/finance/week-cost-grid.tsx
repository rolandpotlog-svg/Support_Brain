"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveWeekInputs } from "@/server/actions/finance";
import { CHANNELS } from "@/lib/finance/channels";

type WeekVals = { weekStart: string; label: string; values: Record<string, number> };

// Kanäle ohne API -> hier von Hand. Meta/Garten kommen automatisch (read-only).
const MANUAL = [
  { key: "google", label: "Google" },
  { key: "taboola", label: "Taboola" },
  { key: "tiktok", label: "TikTok" },
];
const eur0 = (n: number) => (n || 0).toLocaleString("de-DE", { maximumFractionDigits: 0 });

export function WeekCostGrid({ shopId, weeks }: { shopId: string; weeks: WeekVals[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(() => weeks.map((w) => ({ ...w, values: { ...w.values } })));
  const [savingWk, setSavingWk] = useState<string | null>(null);
  const [savedWk, setSavedWk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (weeks.length === 0) return <p className="muted" style={{ margin: 0 }}>Noch keine Wochen — zuerst Shopify-Daten ziehen.</p>;

  function setVal(wk: string, field: string, v: string) {
    setRows((rs) => rs.map((r) => (r.weekStart === wk ? { ...r, values: { ...r.values, [field]: Number(v.replace(",", ".")) || 0 } } : r)));
    setSavedWk(null);
  }

  async function saveRow(wk: string) {
    const r = rows.find((x) => x.weekStart === wk);
    if (!r) return;
    setSavingWk(wk); setError(null); setSavedWk(null);
    try {
      const marketing = Object.fromEntries(CHANNELS.map((c) => [c, r.values[c] ?? 0]));
      await saveWeekInputs(shopId, wk, marketing, r.values.fix ?? 0, r.values.var ?? 0);
      setSavedWk(wk);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingWk(null);
    }
  }

  const inp = (wk: string, field: string) => (
    <input
      inputMode="decimal"
      value={rows.find((r) => r.weekStart === wk)?.values[field] ?? 0}
      onChange={(e) => setVal(wk, field, e.target.value)}
      style={{ width: 80, padding: "5px 7px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", textAlign: "right", fontSize: 13 }}
    />
  );

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        <b>Meta / Garten</b> kommen automatisch aus der API (read-only). <b>Google · Taboola · TikTok · Fix · Variabel</b> hier eintragen, bis die jeweilige API verbunden ist. Pro Zeile speichern.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="fin-table">
          <thead>
            <tr>
              <th>KW</th>
              <th style={{ textAlign: "right" }}>Meta</th>
              <th style={{ textAlign: "right" }}>Garten</th>
              {MANUAL.map((m) => <th key={m.key} style={{ textAlign: "right" }}>{m.label} ✎</th>)}
              <th style={{ textAlign: "right" }}>Fix ✎</th>
              <th style={{ textAlign: "right" }}>Variabel ✎</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.weekStart}>
                <td><b>{r.label}</b></td>
                <td style={{ textAlign: "right" }} className="muted">{eur0(r.values.meta ?? 0)} €</td>
                <td style={{ textAlign: "right" }} className="muted">{eur0(r.values.meta_garten ?? 0)} €</td>
                {MANUAL.map((m) => <td key={m.key} style={{ textAlign: "right" }}>{inp(r.weekStart, m.key)}</td>)}
                <td style={{ textAlign: "right" }}>{inp(r.weekStart, "fix")}</td>
                <td style={{ textAlign: "right" }}>{inp(r.weekStart, "var")}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btnlink primary" disabled={savingWk === r.weekStart} onClick={() => saveRow(r.weekStart)} style={{ padding: "4px 10px", fontSize: 13 }}>
                    {savingWk === r.weekStart ? "…" : savedWk === r.weekStart ? "✓" : "Speichern"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <div className="formerror" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
