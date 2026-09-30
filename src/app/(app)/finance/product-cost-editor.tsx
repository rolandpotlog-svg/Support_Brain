"use client";
// Einkaufspreise je Produkt (Shops ohne feste Regel-Engine, z. B. Lovenja).
// Liste = alle Produkte aus eingelesenen Bestellungen; ohne Preis zuerst.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { importShopifyUnitCosts, saveProductCosts } from "@/server/actions/finance";

type Row = {
  key: string;
  label: string;
  units: number;
  unitCents: number | null;
  source: string | null;
  updatedAtISO: string | null;
};

const inpStyle: React.CSSProperties = {
  width: 100, padding: "5px 8px", borderRadius: 7,
  border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)",
  fontSize: 14, fontWeight: 600, textAlign: "right",
};

export function ProductCostEditor({ shopId, rows }: { shopId: string; rows: Row[] }) {
  const router = useRouter();
  const initial = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.key, r.unitCents == null ? "" : (r.unitCents / 100).toFixed(2)])),
    [rows],
  );
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const missing = rows.filter((r) => r.unitCents == null).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      // Nur geänderte Zeilen schicken.
      const changed = rows
        .filter((r) => (vals[r.key] ?? "") !== (initial[r.key] ?? ""))
        .map((r) => {
          const raw = (vals[r.key] ?? "").trim().replace(",", ".");
          return { key: r.key, label: r.label, euros: raw === "" ? null : parseFloat(raw) };
        });
      if (!changed.length) {
        setMsg("Keine Änderungen.");
        return;
      }
      const r = await saveProductCosts(shopId, changed);
      setMsg(`Gespeichert (${changed.length} Produkt(e)). ${r.orders} Bestellungen neu berechnet.`);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importShopify() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await importShopifyUnitCosts(shopId);
      setMsg(r.message ?? `Aus Shopify übernommen: ${r.imported} · manuell gepflegte behalten: ${r.skipped}`);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        {rows.length === 0
          ? "Noch keine Bestellungen eingelesen — erst unter „Wochen“ Shopify synchronisieren, dann erscheinen hier alle Produkte."
          : missing > 0
            ? <><b>{missing} Produkt(e) ohne Einkaufspreis</b> — deren Bestellungen zählen als „COGS unbekannt“, nicht als 0 €.</>
            : "Alle verkauften Produkte haben einen Einkaufspreis."}
      </p>
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", maxHeight: 520 }}>
          <table className="fin-table">
            <thead>
              <tr>
                <th>Produkt (wie in Shopify)</th>
                <th style={{ textAlign: "right" }}>Verkauft</th>
                <th style={{ textAlign: "right" }}>Einkauf / Stück (€)</th>
                <th>Quelle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ minWidth: 0 }}>{r.label}</td>
                  <td style={{ textAlign: "right" }} className="muted">{r.units}</td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      inputMode="decimal"
                      placeholder="—"
                      value={vals[r.key] ?? ""}
                      onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))}
                      style={{ ...inpStyle, borderColor: r.unitCents == null ? "var(--tag-amber-fg)" : "var(--border)" }}
                      aria-label={`Einkaufspreis ${r.label}`}
                    />
                  </td>
                  <td className="muted">
                    {r.source === "shopify" ? "Shopify" : r.source === "manuell" ? "manuell" : r.source === "upsell" ? "Upsell (0 €)" : "fehlt"}
                    {r.updatedAtISO ? ` · ${new Date(r.updatedAtISO).toLocaleDateString("de-DE")}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        {rows.length > 0 && (
          <button className="primary" onClick={save} disabled={busy}>{busy ? "Speichert…" : "Einkaufspreise speichern"}</button>
        )}
        <button onClick={importShopify} disabled={busy} title="Übernimmt „Kosten pro Artikel“ aus Shopify — manuell gepflegte Preise bleiben.">
          Aus Shopify übernehmen
        </button>
        {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  );
}
