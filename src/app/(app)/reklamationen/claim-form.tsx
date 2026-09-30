"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClaim } from "@/server/actions/claims";

type Initial = { product?: string; orderName?: string; quantity?: string; source?: "manuell" | "wareneingang" };

// Produktvorschläge kommen je Shop aus dessen bisherigen Reklamationen (keine festen Repello-Namen mehr).
export function ClaimForm({ shopId, initial, suggestions = [] }: { shopId: string; initial?: Initial; suggestions?: string[] }) {
  const router = useRouter();
  const [product, setProduct] = useState(initial?.product ?? "");
  const [orderName, setOrderName] = useState(initial?.orderName ?? "");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState(initial?.quantity ?? "1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createClaim({
        shopId,
        productLabel: product,
        orderName: orderName || undefined,
        sku: sku || undefined,
        quantity: Number(quantity) || 1,
        reason,
        source: initial?.source ?? "manuell",
      });
      setProduct(""); setOrderName(""); setSku(""); setQuantity("1"); setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="claimform">
      <div className="claimgrid">
        <label>
          Artikel *
          <input list="claim-products" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="z. B. Sonic Pulse Pro" required />
          <datalist id="claim-products">{suggestions.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label>
          Menge *
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </label>
        <label>
          Bestellung (optional)
          <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="#1234" />
        </label>
        <label>
          SKU (optional)
          <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="McAR08M…" />
        </label>
      </div>
      <label style={{ display: "block", marginTop: 10 }}>
        Defekt / Grund *
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Was ist defekt? Was sieht der Supplier?" required />
      </label>
      <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center" }}>
        <button className="primary" disabled={busy} type="submit">{busy ? "Legt an…" : "Reklamation anlegen"}</button>
        {error && <span className="formerror" style={{ margin: 0 }}>{error}</span>}
      </div>
    </form>
  );
}
