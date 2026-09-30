import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { brandAccess, requireUser } from "@/server/access";
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
import { PaypalCase } from "../paypal-case";
import { MoveShop } from "../move-shop";
import { paypalSiblingShops } from "@/server/paypal-disputes";
import { allowedActions } from "@/lib/paypal/client";
import { db, schema } from "@/server/db";
import { eq } from "drizzle-orm";
import { paypalAdvice, stageLabel, type CaseFacts } from "@/lib/disputes/paypal-policy";

const AUDIT_LABEL: Record<string, string> = {
  submitted: "Eingereicht",
  decision_fight: "Entscheidung: kämpfen",
  decision_accept: "Entscheidung: akzeptieren",
  evidence_saved: "Beweis gespeichert",
  evidence_assembled: "Beweispaket entworfen",
  synced: "Synchronisiert",
  moved_shop: "Shop geändert",
  paypal_message: "PayPal",
  paypal_tracking: "PayPal",
  paypal_statement: "PayPal",
  paypal_refund: "PayPal · Geld",
  paypal_replacement: "PayPal",
};

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await loadCase(id);
  if (!data) notFound();
  if (!(await brandAccess(user, data.case.shopId)).cases) redirect("/inbox");

  const c = data.case;
  const info = reasonInfo(c.reason);
  const u = urgency(c.dueBy, Date.now());
  const suggest = suggestDecision(parseFloat(c.amount || "0") || 0, c.reason);
  const isPaypal = c.source === "paypal";
  const ev = (c.evidence as Record<string, string> | null) ?? {};
  const siblings = isPaypal ? await paypalSiblingShops(c.shopId) : [];
  const ppRow = isPaypal ? await db.query.shopPaypal.findFirst({ where: eq(schema.shopPaypal.shopId, c.shopId) }) : null;
  const siblingsAllowed: { id: string; name: string }[] = [];
  for (const s of siblings) if ((await brandAccess(user, s.id)).cases) siblingsAllowed.push(s);

  return (
    <div className="adminwrap">
      <div className="formhead">
        <Link href={isPaypal ? "/cases?quelle=paypal" : "/cases"} className="back">← Fälle</Link>
        <h1>{c.amount ? euro(c.amount, c.currency || "EUR") : "Dispute"} · {info.label}</h1>
      </div>

      <section className="card">
        <div className="report">
          <div className="rstat"><div className="k">Quelle</div><div className="v">{isPaypal ? "PayPal" : "Shopify Payments"}</div></div>
          <div className="rstat"><div className="k">Status</div><div className="v">{statusLabel(c.status)}</div></div>
          <div className="rstat"><div className="k">Frist</div><div className="v">{countdownLabel(u.hoursLeft)}</div></div>
          {isPaypal
            ? <div className="rstat"><div className="k">Phase</div><div className="v">{stageLabel(c.type)}</div></div>
            : <div className="rstat"><div className="k">Gewinnchance</div><div className="v">{info.chance}</div></div>}
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
        {!isPaypal && <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Schwerpunkt: {info.focus}</p>}
        {isPaypal && <MoveShop caseId={c.id} current={data.shopName ?? ""} others={siblingsAllowed} />}
      </section>

      {!isPaypal && <section className="card">
        <h2>Kämpfen vs. akzeptieren</h2>
        <p style={{ marginTop: 0 }}>
          Empfehlung: <strong>{suggest.suggest === "accept" ? "akzeptieren" : "kämpfen"}</strong> — {suggest.why}
          {c.decision && <span className="muted"> · gewählt: {c.decision === "accept" ? "akzeptieren" : "kämpfen"}</span>}
        </p>
      </section>}

      {isPaypal ? (
        <PaypalCase
          key={`${c.shopId}-${ev.paypalBuyerMessage || ev.paypalResponse ? 1 : 0}`}
          caseId={c.id}
          externalUrl={c.externalUrl}
          stage={stageLabel(c.type)}
          orderName={c.orderName}
          matchConfidence={c.matchConfidence}
          matchNote={c.matchNote}
          facts={(c.facts as CaseFacts | null) ?? null}
          advice={paypalAdvice({ amount: c.amount, reason: c.reason, stage: c.type, matchConfidence: c.matchConfidence, facts: (c.facts as CaseFacts | null) ?? null })}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages={((c.raw as any)?.messages ?? []).map((m: any) => ({ postedBy: m.posted_by ?? "?", time: m.time_posted ?? "", content: m.content ?? "" }))}
          initial={{
            advice: ev.paypalAdvice ?? "",
            buyerMessage: ev.paypalBuyerMessage ?? "",
            statement: ev.paypalResponse ?? "",
            evidence: ev.paypalEvidence ?? "",
          }}
          decision={(c.decision as "fight" | "accept" | null) ?? null}
          mode={ppRow ? (ppRow.mode === "live" ? "live" : "sandbox") : null}
          allowed={allowedActions(c.raw)}
          amount={c.amount}
          currency={c.currency || "EUR"}
        />
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
