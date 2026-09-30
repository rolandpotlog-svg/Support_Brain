"use client";
// Aktionen direkt in PayPal: Nachricht, Tracking nachreichen, Stellungnahme, Erstattung, Ersatz.
// Sichtbar ist nur, was PayPal für den Fall gerade erlaubt. Geld-Aktionen mit Betrags-Bestätigung.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { paypalAction, type PaypalActionInput } from "@/server/actions/paypal";

type Track = { company: string | null; number: string };

export function PaypalActions({
  caseId,
  mode,
  allowed,
  amount,
  currency,
  tracking,
  buyerMessage,
  statement,
}: {
  caseId: string;
  mode: "sandbox" | "live" | null;
  allowed: string[];
  amount: string | null;
  currency: string;
  tracking: Track[];
  buyerMessage: string;
  statement: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [tracks, setTracks] = useState<Track[]>(tracking.length ? tracking : [{ company: "DHL", number: "" }]);
  const [refundAmount, setRefundAmount] = useState(amount ?? "");
  const [refundNote, setRefundNote] = useState("Wir erstatten Ihnen den Betrag. Entschuldigen Sie bitte die Umstände.");
  const [confirmOpen, setConfirmOpen] = useState<"refund" | "replacement" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [replaceNote, setReplaceNote] = useState("Wir senden Ihnen kostenlos Ersatz zu, Sie müssen nichts zurückschicken.");

  const can = (rel: string) => allowed.includes(rel);
  const canRefund = can("accept_claim") || can("make_offer");
  const money = (v: string) => `${(Number(v.replace(",", ".")) || 0).toFixed(2).replace(".", ",")} ${currency}`;

  async function run(key: string, input: PaypalActionInput) {
    setBusy(key);
    setResult(null);
    const r = await paypalAction(caseId, input);
    setBusy(null);
    setResult({ ok: r.ok, text: r.ok ? r.message ?? "Erledigt." : r.error ?? "Fehler" });
    if (r.ok) {
      setConfirmOpen(null);
      setConfirmText("");
    }
    router.refresh();
  }

  if (!mode) return null;
  const none = !can("send_message") && !can("provide_evidence") && !canRefund;

  return (
    <section className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Direkt in PayPal erledigen</h2>
        <span className={`orderbadge ${mode === "live" ? "warn" : "ok"}`}>{mode === "live" ? "LIVE — echtes Geld" : "Sandbox — Testbetrieb"}</span>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Geht sofort an PayPal, der Fall wird dort aktualisiert. Jede Aktion steht im Audit-Log.</p>
      {none && <p className="muted">PayPal erlaubt gerade keine Aktion (z. B. wartet auf den Käufer oder PayPal prüft).</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {can("send_message") && (
          <div className="ppact">
            <div>
              <strong>Nachricht an den Käufer senden</strong>
              <div className="muted" style={{ fontSize: 12 }}>Text aus „1 · Nachricht an den Käufer“ oben.</div>
            </div>
            <button className="primary" disabled={!!busy || !buyerMessage.trim()} onClick={() => run("message", { kind: "message", text: buyerMessage })}>
              {busy === "message" ? "Sendet…" : "Senden"}
            </button>
          </div>
        )}

        {can("provide_evidence") && (
          <div className="ppact" style={{ alignItems: "start" }}>
            <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 0 }}>
              <strong>Tracking nachreichen</strong>
              {tracks.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input value={t.company ?? ""} placeholder="Versanddienst" style={{ maxWidth: 160 }} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, company: e.target.value } : x)))} />
                  <input value={t.number} placeholder="Sendungsnummer" style={{ flex: 1, minWidth: 180 }} onChange={(e) => setTracks(tracks.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                </div>
              ))}
            </div>
            <button disabled={!!busy || !tracks.some((t) => t.number.trim())} onClick={() => run("tracking", { kind: "tracking", tracking: tracks, note: "Sendungsverfolgung zur Bestellung." })}>
              {busy === "tracking" ? "Sendet…" : "Tracking senden"}
            </button>
          </div>
        )}

        {can("provide_evidence") && statement.trim() && (
          <div className="ppact">
            <div>
              <strong>Stellungnahme + Tracking einreichen</strong>
              <div className="muted" style={{ fontSize: 12 }}>Text aus „2 · Stellungnahme an PayPal“, dazu die Sendungsnummern oben.</div>
            </div>
            <button disabled={!!busy} onClick={() => run("statement", { kind: "statement", text: statement, tracking: tracks })}>
              {busy === "statement" ? "Reicht ein…" : "Einreichen"}
            </button>
          </div>
        )}

        {canRefund && (
          <div className="ppact" style={{ alignItems: "start" }}>
            <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 0 }}>
              <strong>Erstatten</strong>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} inputMode="decimal" style={{ maxWidth: 110 }} aria-label="Betrag" />
                <span className="muted" style={{ fontSize: 13 }}>{currency} {amount && refundAmount !== amount ? `(Teil von ${money(amount)}${can("make_offer") ? ", als Angebot" : ""})` : "(voller Betrag)"}</span>
              </div>
              <input value={refundNote} onChange={(e) => setRefundNote(e.target.value)} aria-label="Hinweis an Käufer" />
              {confirmOpen === "refund" && (
                <div className="ppconfirm">
                  Zur Bestätigung den Betrag eintippen ({(Number(refundAmount.replace(",", ".")) || 0).toFixed(2)}):
                  <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} inputMode="decimal" style={{ maxWidth: 110 }} autoFocus />
                    <button className="danger" disabled={!!busy} onClick={() => run("refund", { kind: "refund", amount: refundAmount, note: refundNote, confirm: confirmText })}>
                      {busy === "refund" ? "Erstattet…" : `Jetzt ${money(refundAmount)} erstatten`}
                    </button>
                    <button onClick={() => { setConfirmOpen(null); setConfirmText(""); }}>Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
            {confirmOpen !== "refund" && <button disabled={!!busy} onClick={() => setConfirmOpen("refund")}>Erstatten…</button>}
          </div>
        )}

        {can("make_offer") && (
          <div className="ppact" style={{ alignItems: "start" }}>
            <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 0 }}>
              <strong>Ersatz anbieten (ohne Erstattung)</strong>
              <input value={replaceNote} onChange={(e) => setReplaceNote(e.target.value)} aria-label="Hinweis an Käufer" />
              {confirmOpen === "replacement" && (
                <div className="ppconfirm" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  Ersatz wirklich anbieten? Den Versand macht ihr danach wie gewohnt.
                  <button className="primary" disabled={!!busy} onClick={() => run("replacement", { kind: "replacement", note: replaceNote })}>{busy === "replacement" ? "Sendet…" : "Ja, anbieten"}</button>
                  <button onClick={() => setConfirmOpen(null)}>Abbrechen</button>
                </div>
              )}
            </div>
            {confirmOpen !== "replacement" && <button disabled={!!busy} onClick={() => setConfirmOpen("replacement")}>Ersatz anbieten…</button>}
          </div>
        )}
      </div>
      {result && <p className={result.ok ? "ok-text" : "error"} style={{ marginBottom: 0 }}>{result.text}</p>}
    </section>
  );
}
