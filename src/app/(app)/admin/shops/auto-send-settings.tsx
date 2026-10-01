"use client";
// Automatik je Shop: an/aus, freigegebene Anliegen, Sicherheitsfenster, Tageslimit, Notaus + Stichprobe.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { emergencyStopAuto, saveAutoSend } from "@/server/actions/autosend";

type Readiness = { intent: string; label: string; verbatim: number; edited: number; pct: number | null; ready: boolean; never: boolean };

export function AutoSendSettings({
  shopId,
  isOwner,
  initial,
  readiness,
  stats,
  sample,
}: {
  shopId: string;
  isOwner: boolean;
  initial: { autoSend: boolean; intents: string[]; delayMin: number; dailyMax: number; killSwitch: boolean };
  readiness: Readiness[];
  stats: { sent7: number; reply7: number; pendingNow: number; today: number };
  sample: { threadId: string; number: number; subject: string | null; excerpt: string; at: string; customerReplied: boolean }[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial.autoSend);
  const [intents, setIntents] = useState<string[]>(initial.intents);
  const [delay, setDelay] = useState(initial.delayMin);
  const [max, setMax] = useState(initial.dailyMax);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const readyAllowed = intents.filter((k) => readiness.find((r) => r.intent === k)?.ready);

  async function save() {
    setBusy(true);
    const r = await saveAutoSend(shopId, { autoSend: on, intents, delayMin: delay, dailyMax: max });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? "Gespeichert." : r.error ?? "Fehler" });
    router.refresh();
  }

  return (
    <>
      <section className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Automatisch antworten</h2>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await emergencyStopAuto(shopId);
              setBusy(false);
              setOn(false);
              setMsg({ ok: r.ok, text: r.ok ? `Notaus: Automatik aus, ${r.stopped ?? 0} wartende Antwort(en) gestoppt.` : r.error ?? "Fehler" });
              router.refresh();
            }}
          >
            ⏹ Notaus Automatik
          </button>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Die KI sendet nur, wenn alles stimmt: Anliegen unten freigegeben UND reif (≥ 30× und ≥ 90 % unverändert von euch gesendet), Prüfung bestanden, keine Sperre
          (Anhang, Reklamation, unsichere Bestellung, 3. Mail …), Tageslimit nicht erreicht. Jede automatische Antwort wartet erst im Sicherheitsfenster und kann im Ticket gestoppt werden.
        </p>
        {initial.killSwitch && <p className="error">KI ist für diesen Shop komplett aus (Kill-Switch) — es gibt weder Entwürfe noch Automatik.</p>}

        <div className="report" style={{ marginBottom: 12 }}>
          <div className="rstat"><div className="k">Status</div><div className="v">{initial.autoSend ? (readyAllowed.length ? "aktiv" : "an, aber nichts reif") : "aus"}</div></div>
          <div className="rstat"><div className="k">Heute automatisch</div><div className="v">{stats.today} / {initial.dailyMax}</div></div>
          <div className="rstat"><div className="k">Wartet gerade</div><div className="v">{stats.pendingNow}</div></div>
          <div className="rstat">
            <div className="k">Rückfrage nach Automatik (7 T.)</div>
            <div className="v">{stats.sent7 ? `${Math.round((stats.reply7 / stats.sent7) * 100)} %` : "—"}</div>
            <div className="muted" style={{ fontSize: 12 }}>{stats.reply7} von {stats.sent7} Kunden schrieben danach erneut</div>
          </div>
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
          <input type="checkbox" checked={on} disabled={!isOwner} onChange={(e) => setOn(e.target.checked)} style={{ width: "auto" }} />
          Automatik einschalten
        </label>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ fontSize: 13 }}>
            <thead>
              <tr><th>Freigeben</th><th>Anliegen</th><th>Unverändert</th><th>Geändert</th><th>Quote</th><th>Reif?</th></tr>
            </thead>
            <tbody>
              {readiness.map((r) => (
                <tr key={r.intent}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      disabled={!isOwner || r.never}
                      checked={intents.includes(r.intent)}
                      onChange={(e) => setIntents(e.target.checked ? [...intents, r.intent] : intents.filter((k) => k !== r.intent))}
                    />
                  </td>
                  <td>{r.label}{r.never && <span className="muted"> · nie automatisch</span>}</td>
                  <td>{r.verbatim}</td>
                  <td>{r.edited}</td>
                  <td>{r.pct ?? "—"}{r.pct != null ? " %" : ""}</td>
                  <td>{r.ready ? <span className="orderbadge ok">reif</span> : <span className="muted">{Math.max(0, 30 - r.verbatim)} fehlen{r.pct != null && r.pct < 90 ? " · < 90 %" : ""}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Sicherheitsfenster
            <input type="number" min={2} max={120} value={delay} disabled={!isOwner} onChange={(e) => setDelay(Number(e.target.value))} style={{ width: 70 }} /> Min.
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Höchstens
            <input type="number" min={1} max={500} value={max} disabled={!isOwner} onChange={(e) => setMax(Number(e.target.value))} style={{ width: 80 }} /> pro Tag
          </label>
          {isOwner && <button className="primary" disabled={busy} onClick={save}>Speichern</button>}
          {!isOwner && <span className="muted" style={{ fontSize: 13 }}>Ändern nur durch den Inhaber. Notaus darf jeder.</span>}
          {msg && <span className={msg.ok ? "ok-text" : "error"} style={{ fontSize: 13 }}>{msg.text}</span>}
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Stichprobe: automatisch gesendet (7 Tage)</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Zufällige Auswahl zum Durchsehen. Passt etwas nicht: Ticket öffnen, Regel im KI-Gehirn ergänzen oder das Anliegen oben wieder sperren.</p>
        {sample.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>Noch keine automatischen Antworten.</p>
        ) : (
          <ul className="esc-list">
            {sample.map((s) => (
              <li key={s.threadId + s.at}>
                <Link href={`/inbox?ticket=${s.threadId}`}>#{s.number} {s.subject ?? "(ohne Betreff)"}</Link>
                {s.customerReplied && <span className="orderbadge warn" style={{ marginLeft: 6 }}>Kunde schrieb erneut</span>}
                <div className="muted" style={{ fontSize: 12 }}>{new Date(s.at).toLocaleString("de-AT")} · {s.excerpt}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
