"use client";
// PayPal-Fall: Empfehlung (Score schützen), Abgleich mit Shop-Daten, PayPal-Nachrichten,
// KI-Entwurf (Nachricht an Käufer + ggf. Stellungnahme) zum Kopieren + Link zu PayPal.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { draftPaypalResponse, savePaypalResponse } from "@/server/actions/paypal";
import { setDecision } from "@/server/actions/disputes";
import type { Advice, CaseFacts } from "@/lib/disputes/paypal-policy";
import { PaypalActions } from "./paypal-actions";

function CopyBox({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <label htmlFor={id} style={{ fontWeight: 600 }}>{label}</label>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              (document.getElementById(id) as HTMLTextAreaElement | null)?.select();
            }
          }}
        >
          {copied ? "✓ Kopiert" : "Kopieren"}
        </button>
      </div>
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} style={{ minHeight: 160, fontSize: 14, fieldSizing: "content", maxHeight: "50vh" } as React.CSSProperties} />
    </div>
  );
}

export function PaypalCase({
  caseId,
  externalUrl,
  stage,
  orderName,
  matchConfidence,
  matchNote,
  facts,
  advice,
  messages,
  initial,
  decision,
  mode,
  allowed,
  amount,
  currency,
}: {
  caseId: string;
  externalUrl: string | null;
  stage: string;
  orderName: string | null;
  matchConfidence: string | null;
  matchNote: string | null;
  facts: CaseFacts | null;
  advice: Advice;
  messages: { postedBy: string; time: string; content: string }[];
  initial: { advice: string; buyerMessage: string; statement: string; evidence: string };
  decision: "fight" | "accept" | null;
  mode: "sandbox" | "live" | null;
  allowed: string[];
  amount: string | null;
  currency: string;
}) {
  const router = useRouter();
  const [aiAdvice, setAiAdvice] = useState(initial.advice);
  const [buyer, setBuyer] = useState(initial.buyerMessage);
  const [statement, setStatement] = useState(initial.statement);
  const [evidence, setEvidence] = useState(initial.evidence);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const hasDraft = Boolean(buyer || statement);
  const fight = advice.action === "kaempfen";

  async function draft() {
    setBusy(true);
    setMsg(null);
    const r = await draftPaypalResponse(caseId);
    setBusy(false);
    if (!r.ok || !r.draft) return setMsg(r.error ?? "Fehler");
    setAiAdvice(r.draft.advice);
    setBuyer(r.draft.buyerMessage);
    setStatement(r.draft.statement);
    setEvidence(r.draft.evidence);
    router.refresh();
  }

  const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("de-DE") : "—");
  const delivered = (facts?.delivery ?? "").toUpperCase() === "DELIVERED";

  return (
    <>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>Empfehlung</h2>
        <p style={{ margin: 0 }}>
          <span className={`orderbadge ${fight ? "warn" : "ok"}`}>{advice.label}</span>{" "}
          <span className="muted" style={{ fontSize: 13 }}>Phase: {stage}</span>
        </p>
        <p style={{ marginBottom: 0 }}>{advice.why}</p>
        {aiAdvice && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>KI: {aiAdvice}</p>}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Grundsatz: verlorene PayPal-Fälle schaden dem Verkäuferkonto. Im Zweifel kulant lösen, verteidigen nur mit klarem Beleg.
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Abgleich mit dem Shop</h2>
        <p style={{ marginTop: 0 }}>
          <span className={`orderbadge ${matchConfidence === "sicher" ? "ok" : "warn"}`}>
            {matchConfidence === "sicher" ? "✓ sicher zugeordnet" : matchConfidence === "wahrscheinlich" ? "≈ wahrscheinlich" : "⚠ nicht zugeordnet"}
          </span>{" "}
          {orderName && <strong>{orderName}</strong>} <span className="muted" style={{ fontSize: 13 }}>{matchNote}</span>
        </p>
        {facts ? (
          <div className="report" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div className="rstat"><div className="k">Bestellt</div><div className="v" style={{ fontSize: 15 }}>{date(facts.orderDate)} · {facts.total ?? "—"}</div></div>
            <div className="rstat"><div className="k">Zahlung</div><div className="v" style={{ fontSize: 15 }}>{facts.financialStatus ?? "—"}</div></div>
            <div className="rstat"><div className="k">Versand</div><div className="v" style={{ fontSize: 15 }}>{facts.fulfillment ?? "—"}</div></div>
            <div className="rstat">
              <div className="k">Zustellung</div>
              <div className="v" style={{ fontSize: 15, color: delivered ? "var(--green)" : undefined }}>
                {facts.delivery ?? "unbekannt"}{facts.deliveredAt ? ` · ${date(facts.deliveredAt)}` : ""}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ marginBottom: 0 }}>Keine Shop-Daten, weil keine Bestellung sicher zugeordnet ist.</p>
        )}
        {facts && (
          <div style={{ fontSize: 13, marginTop: 10, display: "grid", gap: 4 }}>
            <div><span className="muted">Artikel:</span> {facts.items.join(", ") || "—"}{facts.personalized ? " · personalisiert" : ""}</div>
            <div><span className="muted">Lieferadresse:</span> {facts.shipTo ?? "—"}</div>
            <div>
              <span className="muted">Tracking:</span>{" "}
              {facts.tracking.length
                ? facts.tracking.map((t, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer">{[t.company, t.number].filter(Boolean).join(" ")} ↗</a> : [t.company, t.number].filter(Boolean).join(" ")}
                    </span>
                  ))
                : "keins"}
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Nachrichten in PayPal ({messages.length})</h2>
        {messages.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Keine Nachrichten.</p>
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
        <h2 style={{ marginTop: 0 }}>Antwort</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
          <button className={hasDraft ? "" : "primary"} onClick={draft} disabled={busy}>{busy ? "Entwirft…" : hasDraft ? "Neu entwerfen (KI)" : "Entwurf erstellen (KI)"}</button>
          {externalUrl && <a className="btnlink primary" href={externalUrl} target="_blank" rel="noopener noreferrer">In PayPal öffnen ↗</a>}
          {hasDraft && (
            <button
              onClick={async () => {
                const r = await savePaypalResponse(caseId, { buyerMessage: buyer, statement });
                setMsg(r.ok ? "Gespeichert." : r.error ?? "Fehler");
              }}
            >
              Änderungen speichern
            </button>
          )}
          {msg && <span className="muted" style={{ fontSize: 13 }}>{msg}</span>}
        </div>
        {!hasDraft && !busy && <p className="muted" style={{ marginTop: 0 }}>Neue Fälle bekommen automatisch einen Entwurf. Hier fehlt noch einer, dann oben auf „Entwurf erstellen“.</p>}
        {hasDraft && (
          <div style={{ display: "grid", gap: 16 }}>
            {buyer && (
              <CopyBox id="pp-buyer" label="1 · Nachricht an den Käufer" hint="Prüfen und anpassen, dann unten „Senden“ (oder kopieren)." value={buyer} onChange={setBuyer} />
            )}
            {statement && (
              <CopyBox id="pp-statement" label="2 · Stellungnahme an PayPal" hint="Nur wenn ihr verteidigt: unten „Einreichen“." value={statement} onChange={setStatement} />
            )}
            {evidence && (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Belege anhängen</div>
                <pre className="mbody" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{evidence}</pre>
              </div>
            )}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>Erledigt als:</span>
          <button className={decision === "accept" ? "primary" : ""} onClick={async () => { await setDecision(caseId, "accept"); router.refresh(); }}>Gelöst / erstattet</button>
          <button className={decision === "fight" ? "primary" : ""} onClick={async () => { await setDecision(caseId, "fight"); router.refresh(); }}>Verteidigt</button>
        </div>
      </section>
      <PaypalActions
        caseId={caseId}
        mode={mode}
        allowed={allowed}
        amount={amount}
        currency={currency}
        tracking={(facts?.tracking ?? []).filter((t) => t.number).map((t) => ({ company: t.company, number: t.number ?? "" }))}
        buyerMessage={buyer}
        statement={statement}
      />
    </>
  );
}
