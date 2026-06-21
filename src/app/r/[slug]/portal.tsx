"use client";
import { useState } from "react";
import {
  portalAccept,
  portalLookup,
  portalOffer,
  type LookupResult,
} from "@/server/actions/returns-public";
import type { Offer, PortalItem } from "@/server/returns";

type Item = PortalItem;
type Reason = { id: string; label: string };

export function ReturnPortal({
  slug,
  shopName,
  accentColor,
  currency,
}: {
  slug: string;
  shopName: string;
  accentColor: string;
  currency: string;
}) {
  const [phase, setPhase] = useState<"lookup" | "select" | "offer" | "done">("lookup");
  const [orderName, setOrderName] = useState("");
  const [email, setEmail] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [selIndex, setSelIndex] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [reasonId, setReasonId] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [caseNumber, setCaseNumber] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fmt = (cents: number) => `${(cents / 100).toFixed(2)} ${currency === "EUR" ? "€" : currency}`;
  const btn = { background: accentColor, color: "#fff", border: "none", borderRadius: 8, padding: "11px 18px", fontSize: 15, fontWeight: 600, cursor: "pointer" };
  const btnGhost = { background: "transparent", color: "#444", border: "1px solid #d4d7de", borderRadius: 8, padding: "11px 18px", fontSize: 15, cursor: "pointer" };

  async function doLookup() {
    setBusy(true); setError(null);
    const res: LookupResult = await portalLookup(slug, orderName, email);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setItems(res.items); setReasons(res.reasons);
    setSelIndex(null); setReasonId("");
    setPhase("select");
  }

  async function loadOffer(step: number) {
    if (selIndex === null || !reasonId) { setError("Bitte Artikel und Grund wählen."); return; }
    setBusy(true); setError(null);
    const res = await portalOffer(slug, orderName, email, reasonId, selIndex, qty, step);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOffer(res.offer); setPhase("offer");
  }

  async function accept(acceptVoucher: boolean) {
    if (selIndex === null || !offer) return;
    setBusy(true); setError(null);
    const res = await portalAccept(slug, orderName, email, reasonId, selIndex, qty, offer.step, acceptVoucher);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCaseNumber(res.number); setPhase("done");
  }

  const wrap: React.CSSProperties = { maxWidth: 520, margin: "40px auto", padding: 24, fontFamily: "-apple-system,Segoe UI,Roboto,sans-serif", color: "#1a1d24" };
  const card: React.CSSProperties = { border: "1px solid #e7e9ee", borderRadius: 14, padding: 22, background: "#fff" };

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: accentColor, color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>
          {shopName.slice(0, 1)}
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>{shopName}</div>
          <div style={{ fontSize: 12, color: "#7a808c" }}>Rückgabe &amp; Umtausch</div>
        </div>
      </div>

      <div style={card}>
        {error && <div style={{ background: "#fde8e6", color: "#c0392b", padding: "10px 12px", borderRadius: 8, marginBottom: 14, fontSize: 14 }}>{error}</div>}

        {phase === "lookup" && (
          <>
            <h2 style={{ marginTop: 0 }}>Bestellung finden</h2>
            <p style={{ color: "#5b616e", fontSize: 14, marginTop: 0 }}>Gib deine Bestellnummer und die E-Mail der Bestellung ein.</p>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Bestellnummer</label>
            <input value={orderName} onChange={(e) => setOrderName(e.target.value)} placeholder="z. B. 1002 oder #1002" style={{ width: "100%", padding: 11, margin: "4px 0 12px", border: "1px solid #d4d7de", borderRadius: 8, fontSize: 15, boxSizing: "border-box" }} />
            <label style={{ fontSize: 13, fontWeight: 600 }}>E-Mail</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="deine@email.de" style={{ width: "100%", padding: 11, margin: "4px 0 16px", border: "1px solid #d4d7de", borderRadius: 8, fontSize: 15, boxSizing: "border-box" }} />
            <button style={btn} disabled={busy} onClick={doLookup}>{busy ? "Suche…" : "Weiter"}</button>
          </>
        )}

        {phase === "select" && (
          <>
            <h2 style={{ marginTop: 0 }}>Was möchtest du zurückgeben?</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((it, i) => (
                <label key={i} style={{ display: "flex", gap: 10, alignItems: "center", border: `1px solid ${selIndex === i ? accentColor : "#e7e9ee"}`, borderRadius: 10, padding: 10, cursor: "pointer" }}>
                  <input type="radio" name="item" checked={selIndex === i} onChange={() => { setSelIndex(i); setQty(1); }} />
                  {it.imageUrl && <img src={it.imageUrl} alt="" width={40} height={40} style={{ borderRadius: 6, objectFit: "cover" }} />}
                  <span style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{it.title}</span>
                    {it.variantTitle && <span style={{ color: "#7a808c" }}> · {it.variantTitle}</span>}
                    <div style={{ fontSize: 13, color: "#7a808c" }}>{fmt(it.unitPriceCents)} · Menge {it.quantity}</div>
                  </span>
                </label>
              ))}
            </div>

            {selIndex !== null && items[selIndex].quantity > 1 && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Menge</label>{" "}
                <select value={qty} onChange={(e) => setQty(Number(e.target.value))} style={{ padding: 8, borderRadius: 8 }}>
                  {Array.from({ length: items[selIndex].quantity }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Grund</label>
              <select value={reasonId} onChange={(e) => setReasonId(e.target.value)} style={{ width: "100%", padding: 11, marginTop: 4, border: "1px solid #d4d7de", borderRadius: 8, fontSize: 15 }}>
                <option value="">Bitte wählen…</option>
                {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
              <button style={btnGhost} onClick={() => setPhase("lookup")}>Zurück</button>
              <button style={btn} disabled={busy || selIndex === null || !reasonId} onClick={() => loadOffer(0)}>{busy ? "…" : "Weiter"}</button>
            </div>
          </>
        )}

        {phase === "offer" && offer && (
          <>
            <h2 style={{ marginTop: 0 }}>Unser Vorschlag</h2>
            <p style={{ fontSize: 15, lineHeight: 1.5 }}>{offer.message}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
              {offer.type === "partial_refund" && (
                <>
                  <button style={btn} disabled={busy} onClick={() => accept(false)}>Ja, {fmt(offer.valueCents)} erstatten &amp; behalten</button>
                  {offer.altVoucherCents !== null && (
                    <button style={btnGhost} disabled={busy} onClick={() => accept(true)}>Lieber {fmt(offer.altVoucherCents)} Guthaben</button>
                  )}
                </>
              )}
              {offer.type === "voucher" && <button style={btn} disabled={busy} onClick={() => accept(true)}>{fmt(offer.valueCents)} Guthaben annehmen</button>}
              {offer.type === "exchange" && <button style={btn} disabled={busy} onClick={() => accept(false)}>Umtausch starten</button>}
              {offer.type === "return" && <button style={btn} disabled={busy} onClick={() => accept(false)}>Rücksendung starten</button>}
              {offer.type === "none" && <button style={btn} disabled={busy} onClick={() => accept(false)}>An den Support weiterleiten</button>}
              {offer.canDecline && <button style={btnGhost} disabled={busy} onClick={() => loadOffer(offer.step + 1)}>Nein danke — andere Option</button>}
            </div>
          </>
        )}

        {phase === "done" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{ fontSize: 40 }}>✓</div>
            <h2 style={{ margin: "8px 0" }}>Alles erledigt!</h2>
            <p style={{ color: "#5b616e", fontSize: 15 }}>
              Deine Anfrage <strong>#{caseNumber}</strong> wird jetzt bearbeitet. Du bekommst in Kürze eine Nachricht von uns.
            </p>
          </div>
        )}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#9aa0ab", marginTop: 14 }}>Sichere Rückgabe · {shopName}</div>
    </div>
  );
}
