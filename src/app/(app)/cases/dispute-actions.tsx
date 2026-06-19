"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assembleEvidence,
  saveEvidence,
  setDecision,
  submitEvidence,
} from "@/server/actions/disputes";

type Evidence = Record<string, string>;

const FIELDS: { key: string; label: string; area?: boolean }[] = [
  { key: "uncategorizedText", label: "Begründung (Hauptnachweis)", area: true },
  { key: "customerEmailAddress", label: "Kunden-E-Mail" },
  { key: "customerFirstName", label: "Vorname" },
  { key: "customerLastName", label: "Nachname" },
  { key: "accessActivityLog", label: "Aktivitäts-/Zugriffslog", area: true },
  { key: "cancellationRebuttal", label: "Stornierungs-Gegendarstellung", area: true },
  { key: "refundPolicyDisclosure", label: "Rückgabe-/Erstattungsrichtlinie", area: true },
];

export function DisputeActions({
  caseId,
  amount,
  currency,
  submitted,
  hasEvidenceId,
  decision,
  initialEvidence,
}: {
  caseId: string;
  amount: string | null;
  currency: string | null;
  submitted: boolean;
  hasEvidenceId: boolean;
  decision: "fight" | "accept" | null;
  initialEvidence: Evidence;
}) {
  const router = useRouter();
  const [ev, setEv] = useState<Evidence>(initialEvidence);
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startBusy(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function field(key: string, value: string) {
    setEv((e) => ({ ...e, [key]: value }));
  }

  return (
    <section className="card">
      <h2>Beweispaket</h2>
      {error && <div className="formerror">{error}</div>}

      <div className="srcrow">
        <button className="btnlink" disabled={busy} onClick={() => run(async () => setEv(await assembleEvidence(caseId)))}>
          {busy ? "…" : "Beweispaket entwerfen"}
        </button>
        <button className={decision === "fight" ? "primary" : ""} disabled={busy} onClick={() => run(() => setDecision(caseId, "fight"))}>
          Kämpfen
        </button>
        <button className={decision === "accept" ? "warn" : ""} disabled={busy} onClick={() => run(() => setDecision(caseId, "accept"))}>
          Akzeptieren
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        „Entwerfen" baut aus Bestellung, Tracking und Ticket-Kommunikation einen Entwurf (deterministisch;
        KI-Formulierung folgt in Phase B). Prüfen, anpassen, dann speichern.
      </p>

      {FIELDS.map((f) => (
        <label className="pfield" key={f.key}>
          <span className="plabel">{f.label}</span>
          {f.area ? (
            <textarea rows={f.key === "uncategorizedText" ? 6 : 3} value={ev[f.key] ?? ""} onChange={(e) => field(f.key, e.target.value)} />
          ) : (
            <input value={ev[f.key] ?? ""} onChange={(e) => field(f.key, e.target.value)} />
          )}
        </label>
      ))}

      <div className="formactions">
        <button disabled={busy} onClick={() => run(() => saveEvidence(caseId, ev))}>Beweis speichern</button>
        <button
          className="primary"
          disabled={busy || submitted || !hasEvidenceId}
          onClick={() => {
            const sum = amount ? `${amount} ${currency ?? ""}`.trim() : "diesen Betrag";
            if (!window.confirm(`Beweis jetzt verbindlich bei Shopify einreichen (${sum})? Das kann nicht rückgängig gemacht werden.`)) return;
            run(() => submitEvidence(caseId));
          }}
        >
          {submitted ? "Bereits eingereicht" : "Einreichen (verbindlich)"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
        Testphase: Einreichung nur per Mensch-Klick, kein Auto-Submit. „Beweis speichern" reicht nichts ein.
      </p>
    </section>
  );
}
