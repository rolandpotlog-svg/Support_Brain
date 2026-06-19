import { redirect } from "next/navigation";
import { requireUser } from "@/server/access";

// Platzhalter für das Dispute-/Chargeback-Management (Shopify Payments + PayPal).
// Bewusst noch ohne Logik: kein Datenabruf, keine Einreichung, nichts Geldbewegendes —
// nur der reservierte Platz, solange die Entscheidung über den Bau noch offen ist.
export default async function CasesPage() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/inbox");

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>Fälle</h1>

      <section className="card">
        <h2>Dispute- & Chargeback-Management</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Status: <strong>in Vorbereitung</strong> — noch nicht aktiv. Hier entsteht das
          Management für Zahlungsstreitfälle, getrennt pro Shop. Aktuell wird nichts abgerufen,
          nichts eingereicht und kein Geld bewegt.
        </p>
        <ul className="esc-list" style={{ marginTop: 12 }}>
          <li><strong>Shopify Payments (Stripe)</strong> — Chargebacks/Disputes über die Shopify Admin API.</li>
          <li><strong>PayPal</strong> — Fälle/Disputes (folgt später, eigene Anbindung).</li>
        </ul>
      </section>

      <section className="card">
        <h2>Geplanter Umfang</h2>
        <ul className="esc-list">
          <li>Übersicht pro Shop, nach Frist sortiert — Ampel/Countdown bis <em>evidence_due_by</em>.</li>
          <li>Verknüpfung von Dispute ↔ Bestellung ↔ Support-Ticket (Kontext: Kommunikation, Tracking).</li>
          <li>Beweispaket strukturiert zusammenbauen (Bestellung, Liefer-/Tracking-Nachweis, Kundenkommunikation).</li>
          <li>Fristen-Alarm (z. B. 72 h und 24 h vorher) — kein Fall darf still ablaufen.</li>
          <li>Mensch prüft &amp; reicht ein (Testphase: nie automatisch), inkl. Audit-Log.</li>
          <li>„Kämpfen vs. akzeptieren"-Empfehlung bei Kleinbeträgen/aussichtslosen Gründen.</li>
          <li>Status &amp; Report: gewonnen/verloren, Win-Rate und zurückgeholte € pro Shop.</li>
          <li>KI formuliert die Begründung passend zum Reason-Code (Phase B, mit Claude API).</li>
        </ul>
        <p className="muted" style={{ fontSize: 13 }}>
          Vor dem Bau nötig: je Shop die Shopify-Scopes für Payments-Disputes ergänzen
          (lesen + schreiben). Bis dahin bleibt dieser Bereich ein Platzhalter.
        </p>
      </section>
    </div>
  );
}
