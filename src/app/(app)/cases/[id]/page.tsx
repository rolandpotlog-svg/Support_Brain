import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/server/access";
import { loadCase } from "@/server/disputes";
import { euro, timeAgo } from "@/lib/format";
import {
  countdownLabel,
  reasonInfo,
  statusLabel,
  suggestDecision,
  urgency,
} from "@/lib/disputes/reasons";
import { DisputeActions } from "../dispute-actions";

const AUDIT_LABEL: Record<string, string> = {
  submitted: "Eingereicht",
  decision_fight: "Entscheidung: kämpfen",
  decision_accept: "Entscheidung: akzeptieren",
  evidence_saved: "Beweis gespeichert",
  evidence_assembled: "Beweispaket entworfen",
  synced: "Synchronisiert",
};

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user.canCases) redirect("/inbox");
  const { id } = await params;
  const data = await loadCase(id);
  if (!data) notFound();

  const c = data.case;
  const info = reasonInfo(c.reason);
  const u = urgency(c.dueBy, Date.now());
  const suggest = suggestDecision(parseFloat(c.amount || "0") || 0, c.reason);
  const isPaypal = c.source === "paypal";

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href="/cases" className="back">← Fälle</Link>
        <h1>{c.amount ? euro(c.amount, c.currency || "EUR") : "Dispute"} · {info.label}</h1>
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Quelle</div><div className="v">{isPaypal ? "PayPal" : "Shopify Payments"}</div></div>
          <div className="rstat"><div className="k">Status</div><div className="v">{statusLabel(c.status)}</div></div>
          <div className="rstat"><div className="k">Frist</div><div className="v">{countdownLabel(u.hoursLeft)}</div></div>
          <div className="rstat"><div className="k">Gewinnchance</div><div className="v">{info.chance}</div></div>
        </div>
        <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          {c.orderName && <>Bestellung <strong>{c.orderName}</strong> · </>}
          Kunde {c.customerName || c.customerEmail || "—"}
          {c.reasonCode && <> · Reason-Code {c.reasonCode}</>}
          {c.type && <> · {c.type}</>}
          {data.thread && (
            <> · <Link href={`/inbox?ticket=${data.thread.id}`}>🎫 Ticket #{data.thread.number}</Link></>
          )}
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Schwerpunkt: {info.focus}</p>
      </section>

      <section className="card">
        <h2>Kämpfen vs. akzeptieren</h2>
        <p style={{ marginTop: 0 }}>
          Empfehlung: <strong>{suggest.suggest === "accept" ? "akzeptieren" : "kämpfen"}</strong> — {suggest.why}
          {c.decision && <span className="muted"> · gewählt: {c.decision === "accept" ? "akzeptieren" : "kämpfen"}</span>}
        </p>
      </section>

      {isPaypal ? (
        <section className="card">
          <h2>PayPal-Fall</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Read-only — die Bearbeitung passiert in PayPal.
          </p>
          {c.externalUrl && <a className="btnlink" href={c.externalUrl} target="_blank" rel="noopener noreferrer">In PayPal öffnen</a>}
        </section>
      ) : (
        <DisputeActions
          caseId={c.id}
          amount={c.amount}
          currency={c.currency}
          submitted={Boolean(c.submittedAt)}
          hasEvidenceId={Boolean(c.providerEvidenceId)}
          decision={(c.decision as "fight" | "accept" | null) ?? null}
          initialEvidence={c.evidence ?? {}}
        />
      )}

      <section className="card">
        <h2>Audit-Log</h2>
        {data.audit.length === 0 && <p className="muted">Noch keine Aktionen.</p>}
        <ul className="esc-list">
          {data.audit.map((a, i) => (
            <li key={i}>
              <strong>{AUDIT_LABEL[a.action] ?? a.action}</strong>
              {a.detail && <> — {a.detail}</>}
              <span className="muted"> · {a.userEmail ?? "System"} · vor {timeAgo(new Date(a.createdAt))}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
