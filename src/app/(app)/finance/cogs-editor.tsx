"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveCogsRates } from "@/server/actions/finance";

type Row = {
  key: string;
  label: string;
  hint: string;
  unitCents: number;
  isDefault: boolean;
  updatedAtISO: string | null;
};

const inpStyle: React.CSSProperties = {
  width: 100, padding: "5px 8px", borderRadius: 7,
  border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)",
  fontSize: 14, fontWeight: 600, textAlign: "right",
};

export function CogsEditor({ shopId, rows }: { shopId: string; rows: Row[] }) {
  const router = useRouter();
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((r) => [r.key, (r.unitCents / 100).toFixed(2)])),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, number> = {};
      for (const r of rows) payload[r.key] = parseFloat((vals[r.key] || "0").replace(",", ".")) || 0;
      await saveCogsRates(shopId, payload);
      setMsg("Gespeichert. Neue & laufende Wochen rechnen ab jetzt mit diesen Kosten.");
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table className="fin-table">
          <thead>
            <tr><th>Produkt</th><th style={{ textAlign: "right" }}>Stückkost (€)</th><th>Bundle / Menge</th><th>Stand</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td style={{ textAlign: "right" }}>
                  <input
                    inputMode="decimal"
                    value={vals[r.key]}
                    onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))}
                    style={inpStyle}
                    aria-label={`Stückkost ${r.label}`}
                  />
                </td>
                <td className="muted">{r.hint}</td>
                <td className="muted">
                  {r.isDefault ? "Standard" : r.updatedAtISO ? new Date(r.updatedAtISO).toLocaleDateString("de-DE") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? "Speichert…" : "Stückkosten speichern"}</button>
        <a className="btnlink" href={`/finance/cogs-export?shop=${shopId}`}>⬇ Als Excel herunterladen</a>
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
