"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addNote,
  assignThread,
  deleteThread,
  escalateThread,
  replyToThread,
  restoreThread,
  retrySend,
  setThreadStatus,
  setThreadTag,
  touchPresence,
} from "@/server/actions/inbox";
import { summarizeThread } from "@/server/actions/ai";
import type { DraftCheck } from "@/server/ai/check";
import { intentLabel } from "@/lib/support/intents";
import { initials, timeAgo } from "@/lib/format";
import { CATEGORIES } from "@/lib/reports/categories";

// Tag-Presets = KI-Kategorien (manuelle Tags und Auto-Tags sind damit identisch).
const TAG_PRESETS: readonly string[] = CATEGORIES;

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  internal: boolean;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  createdAt: string;
  sendStatus?: "pending" | "sent" | "failed" | null;
  sentByName?: string | null;
  sendError?: string | null;
  sendStuck?: boolean;
  attachments?: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};

/** Mail-Text: aktueller Teil sichtbar, zitierter Altverlauf („> …“, „Am … schrieb“) eingeklappt. */
function splitQuoted(text: string): [string, string] {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex(
    (l) =>
      /^\s*>/.test(l) ||
      /^\s*Am .{4,160}(schrieb|wrote)/i.test(l) ||
      /^\s*On .{4,160}wrote/i.test(l) ||
      /^\s*-{2,}\s*(Original|Ursprüngliche Nachricht|Weitergeleitete)/i.test(l) ||
      /^\s*(Von|From):\s.+/.test(l),
  );
  if (i <= 0) return [text, ""];
  return [lines.slice(0, i).join("\n").trimEnd(), lines.slice(i).join("\n")];
}

function MailBody({ text }: { text: string | null }) {
  const [main, quoted] = splitQuoted(text || "");
  return (
    <>
      <pre className="mbody">{main || "(kein Text)"}</pre>
      {quoted && (
        <details className="quoted">
          <summary>Zitierten Verlauf anzeigen</summary>
          <pre className="mbody">{quoted}</pre>
        </details>
      )}
    </>
  );
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function AttachmentList({ atts }: { atts: { id: string; filename: string; contentType: string; sizeBytes: number }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!atts.length) return null;
  const imgs = atts.filter((a) => a.contentType.startsWith("image/"));
  const files = atts.filter((a) => !a.contentType.startsWith("image/"));
  return (
    <div style={{ marginTop: 8 }}>
      {imgs.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>📷 {imgs.length} Foto{imgs.length > 1 ? "s" : ""} — anklicken zum Vergrößern</div>
          <div className="photo-grid">
            {imgs.map((a, i) => (
              <button key={a.id} type="button" className="photo-thumb" onClick={() => setOpen(i)} title={`${a.filename} (${kb(a.sizeBytes)})`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {files.map((a) => (
            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="file-chip">
              📎 {a.filename} <span className="muted">({kb(a.sizeBytes)})</span>
            </a>
          ))}
        </div>
      )}
      {open !== null && <Lightbox imgs={imgs} index={open} onIndex={setOpen} />}
    </div>
  );
}

/** Große Foto-Ansicht im Tool: Pfeiltasten/Buttons zum Blättern, Esc schließt. */
function Lightbox({ imgs, index, onIndex }: { imgs: { id: string; filename: string }[]; index: number; onIndex: (i: number | null) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onIndex(null);
      if (e.key === "ArrowRight") onIndex((index + 1) % imgs.length);
      if (e.key === "ArrowLeft") onIndex((index - 1 + imgs.length) % imgs.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, imgs.length, onIndex]);
  const a = imgs[index];
  return (
    <div className="lightbox" onClick={() => onIndex(null)} role="dialog" aria-label="Foto-Ansicht">
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>Foto {index + 1} von {imgs.length} · {a.filename}</span>
        <span style={{ flex: 1 }} />
        <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">Original öffnen</a>
        <button type="button" onClick={() => onIndex(null)}>Schließen ✕</button>
      </div>
      {imgs.length > 1 && (
        <button type="button" className="lb-nav lb-prev" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + imgs.length) % imgs.length); }} aria-label="Vorheriges Foto">‹</button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/attachments/${a.id}`} alt={a.filename} onClick={(e) => e.stopPropagation()} />
      {imgs.length > 1 && (
        <button type="button" className="lb-nav lb-next" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % imgs.length); }} aria-label="Nächstes Foto">›</button>
      )}
    </div>
  );
}

/** KI-Kopfzeile: was will der Kunde, welches Problem, welcher Artikel, welche Bestellung (+ Prüfungen). */
/** Ergebnis der Entwurfs-Prüfung (Fakten + Prüfer-KI) und warum der Fall nicht automatisch rausgehen dürfte. */
function CheckBadge({ check, checking, drafting }: { check: DraftCheck | null; checking: boolean; drafting: boolean }) {
  const [open, setOpen] = useState(false);
  if (drafting) return <div className="checkbar muted">✨ KI schreibt den Entwurf…</div>;
  if (checking) return <div className="checkbar muted">🔎 Prüfung läuft…</div>;
  if (!check) return null;
  const problems = [...check.facts, ...(check.reviewer?.issues ?? [])];
  const ok = check.passed;
  return (
    <div className={`checkbar ${ok ? "ok" : "warn"}`}>
      <button type="button" className="checkbar-head" onClick={() => setOpen(!open)}>
        {ok ? "✓ Prüfung bestanden" : check.reviewer === null && !check.facts.length ? "⚠ Prüfung nicht gelaufen" : `⚠ Prüfung: ${problems.length} Hinweis${problems.length === 1 ? "" : "e"}`}
        {check.blocks.length > 0 && <span className="muted"> · nicht automatisch: {check.blocks[0]}{check.blocks.length > 1 ? ` (+${check.blocks.length - 1})` : ""}</span>}
        <span className="muted"> {open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul>
          {problems.map((p, i) => <li key={i}>{p}</li>)}
          {check.blocks.map((b, i) => <li key={`b${i}`} className="muted">Sperre: {b}</li>)}
          {!problems.length && !check.blocks.length && <li className="muted">Keine Auffälligkeiten. Wäre für die Automatik geeignet.</li>}
        </ul>
      )}
    </div>
  );
}

function AiHeader({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const checks = thread.orderChecks ?? [];
  const warn = checks.filter((c) => c.status === "warn" || c.status === "fail").length;
  const conf = thread.orderConfidence;
  return (
    <div className="aihead">
      <div className="aihead-row">
        {thread.aiIntent && (
          <span className={`ichip i-${thread.aiIntent}`}>
            {intentLabel(thread.aiIntent)}
            {thread.aiIssue ? ` · ${thread.aiIssue}` : ""}
          </span>
        )}
        {thread.aiItem && <span className="aihead-item">{thread.aiItem}</span>}
        <span className="spacer" />
        {thread.orderName && (
          <button type="button" className={`orderbadge ${conf === "sicher" ? "ok" : "warn"}`} onClick={() => setOpen((o) => !o)} title="Abgleich anzeigen">
            {thread.orderName} · {conf === "sicher" ? "✓ sicher zugeordnet" : "⚠ unsicher"}
            {warn > 0 ? ` · ${warn} Hinweis${warn > 1 ? "e" : ""}` : ""}
          </button>
        )}
      </div>
      {thread.aiSummary && <div className="aihead-sum">{thread.aiSummary}</div>}
      {open && checks.length > 0 && (
        <ul className="aihead-checks">
          {checks.map((c, i) => (
            <li key={i} className={`c-${c.status}`}>
              {c.status === "ok" ? "✓" : c.status === "fail" ? "✕" : c.status === "warn" ? "!" : "·"} {c.label}
              {c.detail ? <span className="muted"> — {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Assignee = { id: string; name: string | null; email: string };
type Thread = {
  id: string;
  subject: string | null;
  customerEmail: string;
  customerName: string | null;
  status: string;
  assigneeId: string | null;
  tag: string | null;
  deleted?: boolean;
  aiDraft?: string | null;
  aiDraftFresh?: boolean;
  aiCheck?: DraftCheck | null;
  aiDecision?: string | null;
  aiReason?: string | null;
  aiIntent?: string | null;
  aiIssue?: string | null;
  aiItem?: string | null;
  aiSummary?: string | null;
  orderName?: string | null;
  orderConfidence?: string | null;
  orderChecks?: { label: string; status: string; detail?: string }[];
};

export function Conversation({
  thread,
  messages,
  supportEmail,
  assignees,
  disputeId,
  cannedReplies = [],
  nextHref = null,
}: {
  thread: Thread;
  messages: Msg[];
  supportEmail: string;
  assignees: Assignee[];
  disputeId?: string | null;
  cannedReplies?: { id: string; title: string; body: string }[];
  nextHref?: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"reply" | "note">("reply");
  // Vorbefüllt mit dem Auto-Entwurf der KI (falls vorhanden) — Senden bleibt eine menschliche Freigabe.
  // Nur ein Entwurf, der zur AKTUELLEN Kundenmail passt — ein alter Entwurf würde eine frühere Mail beantworten.
  const [text, setText] = useState(thread.aiDraftFresh ? thread.aiDraft ?? "" : "");
  const [check, setCheck] = useState<DraftCheck | null>(thread.aiDraftFresh ? thread.aiCheck ?? null : null);
  const [checking, setChecking] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [noteText, setNoteText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // KI hat den Fall als „Mensch muss entscheiden" markiert (Grund) — Hinweis über dem Antwortfeld.
  const [aiHint, setAiHint] = useState<string | null>(
    thread.aiDraftFresh && thread.aiDecision === "mensch" ? thread.aiReason || "Bitte prüfen" : null,
  );
  const [pending, start] = useTransition();

  // KI-Entwurf live: Text erscheint beim Schreiben, danach kommt das Prüfergebnis.
  async function streamDraft(intent?: string, onlyIfMissing = false) {
    setError(null);
    setDrafting(true);
    setCheck(null);
    let started = false;
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, intent, onlyIfMissing }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => "")) || `Fehler ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.t === "delta") {
            if (!started) { started = true; setText(""); }
            setText((prev) => prev + ev.v);
          } else if (ev.t === "done") {
            if (ev.text) setText(ev.text);
            setAiHint(ev.decision === "mensch" ? ev.reason || "Bitte prüfen" : null);
            setDrafting(false);
            setChecking(true);
          } else if (ev.t === "check") {
            const { t: _t, ...c } = ev;
            setCheck(c as DraftCheck);
            setChecking(false);
          } else if (ev.t === "error") {
            throw new Error(ev.error);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
      setChecking(false);
    }
  }

  // Ticket geöffnet, letzte Nachricht vom Kunden, aber noch kein passender Entwurf -> sofort starten.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    const last = [...messages].reverse().find((m) => !m.internal);
    if (thread.aiDraftFresh || thread.deleted || thread.status !== "open" || last?.direction !== "inbound") return;
    autoStarted.current = true;
    void streamDraft(undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kollisionsschutz: alle 15 s melden „ich bin hier (tippe?)“ und anzeigen, wer sonst gerade dran ist.
  const [others, setOthers] = useState<{ name: string; typing: boolean }[]>([]);
  const typingRef = useRef(false);
  typingRef.current = text.trim().length > 0 && text !== (thread.aiDraft ?? "");
  useEffect(() => {
    let alive = true;
    const ping = () =>
      touchPresence(thread.id, typingRef.current)
        .then((o) => alive && setOthers(o))
        .catch(() => {});
    ping();
    const iv = setInterval(ping, 15_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [thread.id]);

  function run(fn: () => Promise<void>) {
    setError(null);
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  const isClosed = thread.status === "closed";
  const isSpam = thread.status === "spam";
  const isDeleted = !!thread.deleted;

  return (
    <section className="convo">
      <div className="chead">
        <Link href="/inbox" className="mobile-back" title="Zurück zur Liste" aria-label="Zurück">←</Link>
        <h2>{thread.subject || "(kein Betreff)"}</h2>
        {disputeId && (
          <Link href={`/cases/${disputeId}`} className="disputebadge" title="Verknüpfter Zahlungsstreitfall">
            ⚠ Dispute
          </Link>
        )}
        <button className="icon-btn ghost" title="Eskalieren" onClick={() => {
          const reason = window.prompt("Grund für die Eskalation an die Geschäftsführung?") ?? "";
          run(() => escalateThread(thread.id, reason));
        }}>⚑</button>
        {isClosed ? (
          <button disabled={pending} onClick={() => run(() => setThreadStatus(thread.id, "open"))}>
            ↩ Wieder öffnen
          </button>
        ) : (
          <button className="green" disabled={pending} onClick={() => run(() => setThreadStatus(thread.id, "closed"))}>
            ✓ Schließen
          </button>
        )}
        <button
          className={isSpam ? "" : "warn"}
          disabled={pending}
          onClick={() => run(() => setThreadStatus(thread.id, isSpam ? "open" : "spam"))}
        >
          {isSpam ? "Kein Spam" : "⊘ Spam"}
        </button>
        {isDeleted ? (
          <button disabled={pending} onClick={() => run(() => restoreThread(thread.id))}>
            ↩ Wiederherstellen
          </button>
        ) : (
          <button
            className="warn"
            disabled={pending}
            title="Ins Papierkorb legen — Mail wandert in den Trash-Ordner"
            onClick={() => run(() => deleteThread(thread.id))}
          >
            🗑 Löschen
          </button>
        )}
      </div>

      <div className="ctoolbar">
        <label className="ctool">
          <span>Zugewiesen</span>
          <select
            value={thread.assigneeId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => assignThread(thread.id, e.target.value || null))}
          >
            <option value="">— niemand</option>
            {assignees.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </label>
        <label className="ctool">
          <span>Tag</span>
          <select
            value={thread.tag ?? ""}
            disabled={pending}
            onChange={(e) => run(() => setThreadTag(thread.id, e.target.value || null))}
          >
            <option value="">— kein Tag</option>
            {TAG_PRESETS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
            {thread.tag && !TAG_PRESETS.includes(thread.tag) && (
              <option value={thread.tag}>{thread.tag}</option>
            )}
          </select>
        </label>
        <button
          className="btnlink"
          style={{ marginLeft: "auto" }}
          disabled={summarizing}
          onClick={async () => {
            setError(null);
            setSummarizing(true);
            try {
              setSummary(await summarizeThread(thread.id));
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSummarizing(false);
            }
          }}
        >
          {summarizing ? "Fasst zusammen…" : summary ? "🧾 Neu zusammenfassen" : "🧾 Zusammenfassen"}
        </button>
      </div>

      {summary && (
        <div className="csummary">
          <div className="srcrow" style={{ alignItems: "center", marginBottom: 4 }}>
            <strong style={{ fontSize: 13 }}>Zusammenfassung</strong>
            <button className="btnlink" style={{ marginLeft: "auto" }} onClick={() => setSummary(null)}>
              ausblenden
            </button>
          </div>
          <pre className="promptview" style={{ margin: 0 }}>{summary}</pre>
        </div>
      )}

      {others.length > 0 && (
        <div className="alertbar warn" style={{ margin: "8px 18px 0" }}>
          👀 {others.map((o) => `${o.name}${o.typing ? " schreibt gerade eine Antwort" : " hat dieses Ticket offen"}`).join(" · ")}
        </div>
      )}
      {(thread.aiIntent || thread.orderName) && <AiHeader thread={thread} />}
      <div className="body">
        {error && <p className="error">{error}</p>}
        {messages.map((m) =>
          m.internal ? (
            <article key={m.id} className="note-msg">
              <div className="mhead">
                <span className="note-tag">📝 Interne Notiz</span>
                <span className="muted" style={{ fontSize: 12 }}>{m.fromEmail}</span>
                <div className="mtime">{timeAgo(new Date(m.createdAt))}</div>
              </div>
              <pre className="mbody">{m.bodyText || ""}</pre>
            </article>
          ) : (
            <article key={m.id} className={`mail ${m.direction}`}>
              <div className="mhead">
                <div className="mavatar">
                  {m.direction === "inbound" ? initials(thread.customerName, thread.customerEmail) : "S"}
                </div>
                <div>
                  <div className="mfrom">
                    {m.direction === "inbound" ? thread.customerName || thread.customerEmail : "Support"}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {m.direction === "inbound" ? m.fromEmail : supportEmail}
                  </div>
                </div>
                <div className="mtime">{timeAgo(new Date(m.createdAt))}</div>
              </div>
              <MailBody text={m.bodyText} />
              <AttachmentList atts={m.attachments ?? []} />
              {m.direction === "outbound" && m.sendStatus && (
                <div className="sendstatus" style={{ marginTop: 6 }}>
                  {m.sendStatus === "sent" && <span className="ok-text" style={{ fontSize: 12 }}>✓ gesendet{m.sentByName ? ` von ${m.sentByName}` : ""}</span>}
                  {m.sendStatus === "pending" && !m.sendStuck && (
                    <span style={{ fontSize: 12, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="muted">⏳ in Warteschlange…</span>
                      <button className="btnlink" disabled={pending} onClick={() => run(() => retrySend(m.id))} style={{ fontSize: 12 }}>
                        Jetzt senden
                      </button>
                    </span>
                  )}
                  {m.sendStatus === "pending" && m.sendStuck && (
                    <span className="bad-text" style={{ fontSize: 12, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      ⚠ Hängt fest — noch nicht zugestellt
                      <button className="btnlink" disabled={pending} onClick={() => run(() => retrySend(m.id))} style={{ fontSize: 12 }}>
                        Jetzt senden
                      </button>
                    </span>
                  )}
                  {m.sendStatus === "failed" && (
                    <span className="bad-text" style={{ fontSize: 12, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      ⚠ Senden fehlgeschlagen{m.sendError ? `: ${m.sendError}` : ""}
                      <button className="btnlink" disabled={pending} onClick={() => run(() => retrySend(m.id))} style={{ fontSize: 12 }}>
                        Erneut senden
                      </button>
                    </span>
                  )}
                </div>
              )}
            </article>
          ),
        )}
      </div>

      <div className="editor">
        <div className="fields">
          <div className="frow"><span className="lbl">AN</span><span className="val">{thread.customerEmail}</span></div>
          <div className="frow"><span className="lbl">VON</span><span className="val">{supportEmail}</span></div>
        </div>
        <div className="tabs">
          <div className={`t ${tab === "reply" ? "active" : ""}`} onClick={() => setTab("reply")}>Antwort</div>
          <div className={`t ${tab === "note" ? "active" : ""}`} onClick={() => setTab("note")}>Notiz</div>
        </div>
        {tab === "reply" ? (
          <>
            {aiHint && <div className="alertbar warn" style={{ marginBottom: 8 }}>🧑‍💼 KI empfiehlt: Mensch entscheidet — {aiHint}</div>}
            <CheckBadge check={check} checking={checking} drafting={drafting} />
            <textarea
              placeholder="Antwort verfassen… (wird erst nach Freigabe gesendet)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              // Wächst mit dem Text, max. ~1/3 Bildschirmhöhe — der Verlauf behält immer genug Platz.
              style={{ minHeight: 110, maxHeight: "min(34vh, 320px)", resize: "vertical", fieldSizing: "content" } as React.CSSProperties}
            />
            {files.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0 0" }}>
                {files.map((f, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--panel-2)",
                      fontSize: 12,
                    }}
                  >
                    📎 {f.name}
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0 }}
                      title="Anhang entfernen"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="actions">
              <label className="btnlink" style={{ cursor: "pointer", fontSize: 13, display: "inline-flex", alignItems: "center" }} title="Datei/Foto anhängen (max. 5 × 8 MB)">
                📎
                <input
                  type="file"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []).filter((f) => f.size <= 8 * 1024 * 1024);
                    setFiles((prev) => [...prev, ...list].slice(0, 5));
                    e.target.value = "";
                  }}
                />
              </label>
              {cannedReplies.length > 0 ? (
                <select
                  value=""
                  disabled={drafting || pending}
                  title="Schnellantwort: KI schreibt die Mail zur gewählten Absicht"
                  onChange={async (e) => {
                    const c = cannedReplies.find((x) => x.id === e.target.value);
                    e.target.value = "";
                    if (!c) return;
                    await streamDraft(c.body);
                  }}
                  style={{ maxWidth: 200 }}
                >
                  <option value="">⚡ Schnellantwort (KI)…</option>
                  {cannedReplies.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              ) : (
                <Link href="/textbausteine" className="btnlink" style={{ fontSize: 13 }}>⚡ Schnellantworten anlegen</Link>
              )}
              <button
                disabled={drafting || pending}
                title="Antwortentwurf von der KI (Shop-Profil + Bestelldaten)"
                onClick={() => void streamDraft()}
              >
                {drafting ? "Entwirft…" : "✨ KI-Entwurf"}
              </button>
              <span className="spacer" />
              <button
                className="primary"
                disabled={pending || drafting || !text.trim()}
                title={nextHref ? "Sendet und springt direkt zum nächsten Ticket" : undefined}
                onClick={() =>
                  run(async () => {
                    let fd: FormData | undefined;
                    if (files.length) {
                      fd = new FormData();
                      for (const f of files) fd.append("files", f);
                    }
                    const r = await replyToThread(thread.id, text, fd, messages.filter((x) => !x.internal).at(-1)?.id);
                    if (!r.ok) throw new Error(r.error);
                    setText("");
                    setAiHint(null);
                    setFiles([]);
                    // Wie im Mail-Fach: nach dem Senden direkt das nächste Ticket öffnen.
                    if (nextHref) router.push(nextHref);
                  })
                }
              >
                {pending ? "Sendet…" : nextHref ? "Senden ▸ nächstes Ticket" : "Antwort freigeben & senden"}
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              placeholder="Interne Notiz (nur fürs Team, der Kunde sieht sie nicht)…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="actions">
              <span className="spacer" />
              <button
                disabled={pending || !noteText.trim()}
                onClick={() =>
                  run(async () => {
                    await addNote(thread.id, noteText);
                    setNoteText("");
                  })
                }
              >
                {pending ? "Speichert…" : "Notiz speichern"}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
