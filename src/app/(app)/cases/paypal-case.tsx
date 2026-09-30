"use client";
// PayPal-Fall: Zuordnung, PayPal-Nachrichten, KI-Stellungnahme (bearbeiten, kopieren) + Link zu PayPal.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { draftPaypalResponse, savePaypalResponse } from "@/server/actions/paypal";
import { setDecision } from "@/server/actions/disputes";

export function PaypalCase({
  caseId,
  externalUrl,
  matchConfidence,
  matchNote,
  messages,
  initialText,
  decision,
}: {
  caseId: string;
  externalUrl: string | null;
  matchConfidence: string | null;
  matchNote: string | null;
  messages: { postedBy: string; time: string; content: string }[];
  initialText: string;
  decision: "fight" | "accept" | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function draft() {
    setBusy(true);
    setMsg(null);
    const r = await draftPaypalResponse(caseId);
    setBusy(false);
    if (!r.ok) return setMsg(r.error ?? "Fehler");
    setText(r.text ?? "");
    router.refresh();
  }

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Zuordnung</h2>
        <p style={{ margin: 0 }}>
          <span className={`orderbadge ${matchConfidence === "sicher" ? "ok" : "warn"}`}>
            {matchConfidence === "sicher" ? "✓ sicher zugeordnet" : matchConfidence === "wahrscheinlich" ? "≈ wahrscheinlich" : "⚠ nicht zugeordnet"}
          </span>{" "}
          <span className="muted" style={{ fontSize: 13 }}>{matchNote}</span>
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Nachrichten in PayPal ({messages.length})</h2>
        {messages.length === 0 ? (
          <p className="muted">Keine Nachrichten.</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m, i) => (
              <div key={i} className={`mail ${m.postedBy === "SELLER" ? "outbound" : "inbound"}`} style={{ margin: 0 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  {m.postedBy === "SELLER" ? "Wir" : m.postedBy === "BUYER" ? "Käufer" : m.postedBy} · {m.time ? new Date(m.time).toLocaleString("de-DE") : ""}
                </div>
                <pre className="mbody">{m.content}</pre>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Stellungnahme an PayPal</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Die KI fasst Bestellung, Versand/Zustellung, euren Mailverlauf und eure Regeln zusammen. Prüfen, anpassen, dann in PayPal einfügen und Belege anhängen.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button className="primary" onClick={draft} disabled={busy}>{busy ? "Entwirft…" : text ? "Neu entwerfen (KI)" : "Antwort an PayPal entwerfen (KI)"}</button>
          {text && (
            <>
              <button onClick={async () => { await savePaypalResponse(caseId, text); setMsg("Gespeichert."); }}>Speichern</button>
              <button onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg("In die Zwischenablage kopiert."); } catch { setMsg("Bitte Text markieren und kopieren."); } }}>Kopieren</button>
            </>
          )}
          {externalUrl && <a className="btnlink" href={externalUrl} target="_blank" rel="noopener noreferrer">In PayPal öffnen ↗</a>}
          {msg && <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>{msg}</span>}
        </div>
        {text && <textarea id="pp-response" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 320, fontSize: 14 }} />}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>Entscheidung:</span>
          <button className={decision === "fight" ? "primary" : ""} onClick={async () => { await setDecision(caseId, "fight"); router.refresh(); }}>Kämpfen</button>
          <button className={decision === "accept" ? "primary" : ""} onClick={async () => { await setDecision(caseId, "accept"); router.refresh(); }}>Akzeptieren</button>
        </div>
      </section>
    </>
  );
}
