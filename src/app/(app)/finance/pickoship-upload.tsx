"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { commitPickoshipShipping, parsePickoshipUpload, type PickoshipReview } from "@/server/actions/finance";

const eur = (c: number) => `${(c / 100).toFixed(2)} €`;

export function PickoshipUpload({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [review, setReview] = useState<PickoshipReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError(null); setMsg(null); setReview(null);
    try {
      const fd = new FormData();
      fd.set("shopId", shopId);
      fd.set("file", file);
      setReview(await parsePickoshipUpload(fd));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function commit() {
    if (!review) return;
    setBusy(true); setError(null);
    try {
      const r = await commitPickoshipShipping(shopId, review.orders);
      setMsg(`${r.count} Versandwerte verbucht.`);
      setReview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="btnlink" style={{ cursor: "pointer", display: "inline-flex" }}>
        {busy ? "Liest PDF…" : "📄 Pickoship-Beleg (PDF) wählen"}
        <input type="file" accept="application/pdf" onChange={onFile} disabled={busy} style={{ display: "none" }} />
      </label>
      {msg && <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>{msg}</span>}
      {error && <div className="formerror" style={{ marginTop: 10 }}>{error}</div>}

      {review && (
        <div className="card" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="cardhead">
            <h3 style={{ margin: 0 }}>Kontrolle {review.invoiceNumber ? `· ${review.invoiceNumber}` : ""}</h3>
            <span className={review.matches ? "ok-text" : "bad-text"}>
              {review.matches ? "✓ Summe stimmt mit Rechnung" : "✗ Summe weicht ab — prüfen!"}
            </span>
          </div>
          <ul className="esc-list">
            <li>Bestellungen im Beleg: <strong>{review.orders.length}</strong></li>
            <li>Versand-Summe (geparst): <strong>{eur(review.parsedTotalCents)}</strong>{" "}
              {review.invoiceTotalCents !== null && <span className="muted">vs. Rechnung {eur(review.invoiceTotalCents)}</span>}</li>
            <li>In Shopify gefunden: <strong>{review.knownCount}</strong> / {review.orders.length}
              {review.unknownNames.length > 0 && <span className="bad-text"> · nicht gefunden: {review.unknownNames.join(", ")}{review.unknownNames.length >= 20 ? " …" : ""}</span>}</li>
          </ul>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Bitte gegen den PDF-Beleg prüfen (hat der Supplier korrekt abgerechnet?). Erst dann verbuchen.
          </p>
          <div className="srcrow" style={{ alignItems: "center" }}>
            <button className="primary" disabled={busy} onClick={commit}>Prüfung ok → verbuchen</button>
            <button className="btnlink" disabled={busy} onClick={() => setReview(null)}>Verwerfen</button>
          </div>
        </div>
      )}
    </div>
  );
}
