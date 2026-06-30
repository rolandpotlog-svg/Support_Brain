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
      setMsg(`Versand + echte COGS für ${r.count} Bestellungen aus der Rechnung verbucht.`);
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

          {/* COGS-Abgleich: Produktkosten lt. Rechnung vs. unsere Engine + Stückpreis-Check */}
          <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <div className="cardhead">
              <h3 style={{ margin: 0, fontSize: 15 }}>Produktkosten (COGS)</h3>
              <span className={review.cogsMatches ? "ok-text" : "bad-text"}>
                {review.cogsMatches ? "✓ COGS deckt sich mit Engine" : "✗ COGS weicht ab — prüfen!"}
              </span>
            </div>
            <ul className="esc-list">
              <li>Produktkosten lt. Rechnung (Menge × Stückpreis): <strong>{eur(review.productTotalCents)}</strong>{" "}
                {review.invoiceProductTotalCents !== null && <span className="muted">vs. „Total Product Price" {eur(review.invoiceProductTotalCents)}</span>}</li>
              <li>Unsere Engine-COGS (gleiche Orders): <strong>{eur(review.ourCogsCents)}</strong></li>
              <li>Stückpreise im Beleg:{" "}
                {review.rateChecks.map((rc) => (
                  <span key={rc.priceCents} className={rc.known ? "ok-text" : "bad-text"} style={{ marginRight: 10 }}>
                    {rc.known ? "✓" : "⚠"} {eur(rc.priceCents)} × {rc.qty}
                  </span>
                ))}
              </li>
            </ul>
            {review.rateChecks.some((rc) => !rc.known) && (
              <p className="bad-text" style={{ margin: "0 0 6px", fontSize: 13 }}>
                ⚠ Mind. ein Stückpreis weicht von deinen hinterlegten Stückkosten ab — Supplier-Preis geändert? Oben bei „Stückkosten" anpassen.
              </p>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Hinweis: Die <b>AMOUNT</b>-Spalte mischt Versand + ggf. Produkt — als COGS gilt nur <b>Menge × Stückpreis</b>.
            </p>
          </div>

          {/* Shopify-Abgleich: Abdeckung beidseitig + Order-für-Order */}
          <div style={{ marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <div className="cardhead">
              <h3 style={{ margin: 0, fontSize: 15 }}>Shopify-Abgleich</h3>
              <span className={review.missingFromInvoice.length === 0 && review.cogsOrderMismatches.length === 0 && review.unknownNames.length === 0 ? "ok-text" : "bad-text"}>
                {review.missingFromInvoice.length === 0 && review.cogsOrderMismatches.length === 0 && review.unknownNames.length === 0 ? "✓ deckt sich mit Shopify" : "✗ Abweichungen — prüfen!"}
              </span>
            </div>
            <ul className="esc-list">
              <li>Im Beleg-Zeitraum{review.dateSince ? ` (${review.dateSince} – ${review.dateUntil})` : ""}: <strong>{review.shopifyInRangeCount}</strong> Shopify-Bestellungen · <strong>{review.orders.length}</strong> im Beleg</li>
              {review.missingFromInvoice.length > 0 && (
                <li className="bad-text"><b>{review.missingFromInvoice.length}</b> Shopify-Bestellung(en) <b>fehlen im Beleg</b> (nicht versendet/abgerechnet?): {review.missingFromInvoice.join(", ")}{review.missingFromInvoice.length >= 20 ? " …" : ""}</li>
              )}
              {review.unknownNames.length > 0 && (
                <li className="bad-text"><b>{review.unknownNames.length}</b> im Beleg, aber <b>nicht in Shopify</b>: {review.unknownNames.join(", ")}</li>
              )}
              {review.cogsOrderMismatches.length === 0 ? (
                <li className="ok-text">Order-für-Order COGS: keine Abweichung ✓</li>
              ) : (
                <li className="bad-text"><b>{review.cogsOrderMismatches.length}</b> Order(s) mit COGS-Abweichung Rechnung↔Shopify:</li>
              )}
            </ul>
            {review.cogsOrderMismatches.length > 0 && (
              <table className="fin-table" style={{ marginTop: 4 }}>
                <thead><tr><th>Order</th><th style={{ textAlign: "right" }}>Rechnung</th><th style={{ textAlign: "right" }}>Shopify (Engine)</th><th style={{ textAlign: "right" }}>Δ</th></tr></thead>
                <tbody>
                  {review.cogsOrderMismatches.map((d) => (
                    <tr key={d.orderName}>
                      <td>{d.orderName}</td>
                      <td style={{ textAlign: "right" }}>{eur(d.invoiceCents)}</td>
                      <td style={{ textAlign: "right" }}>{eur(d.shopifyCents)}</td>
                      <td style={{ textAlign: "right", color: "var(--danger, #e5634d)" }}>{eur(d.invoiceCents - d.shopifyCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Bitte gegen den PDF-Beleg prüfen (hat der Supplier korrekt abgerechnet?). Erst dann verbuchen (bucht Versand).
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
