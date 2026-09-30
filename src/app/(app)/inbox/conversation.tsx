"use client";
import { useState, useTransition } from "react";
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
} from "@/server/actions/inbox";
import { draftReply, summarizeThread } from "@/server/actions/ai";
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
  sendError?: string | null;
  sendStuck?: boolean;
  attachments?: { id: string; filename: string; contentType: string; sizeBytes: number }[];
};

function AttachmentList({ atts }: { atts: { id: string; filename: string; contentType: string; sizeBytes: number }[] }) {
  if (!atts.length) return null;
  const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {atts.map((a) =>
        a.contentType.startsWith("image/") ? (
          <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" title={`${a.filename} (${kb(a.sizeBytes)})`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/attachments/${a.id}`}
              alt={a.filename}
              style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", display: "block" }}
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={`/api/attachments/${a.id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--panel-2)",
              color: "inherit",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            📎 {a.filename} <span className="muted">({kb(a.sizeBytes)})</span>
          </a>
        ),
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
  aiDecision?: string | null;
  aiReason?: string | null;
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
  const [text, setText] = useState(thread.aiDraft ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [noteText, setNoteText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // KI hat den Fall als „Mensch muss entscheiden" markiert (Grund) — Hinweis über dem Antwortfeld.
  const [aiHint, setAiHint] = useState<string | null>(
    thread.aiDraft && thread.aiDecision === "mensch" ? thread.aiReason || "Bitte prüfen" : null,
  );
  const [pending, start] = useTransition();

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
              <pre className="mbody">{m.bodyText || "(kein Text)"}</pre>
              <AttachmentList atts={m.attachments ?? []} />
              {m.direction === "outbound" && m.sendStatus && (
                <div className="sendstatus" style={{ marginTop: 6 }}>
                  {m.sendStatus === "sent" && <span className="ok-text" style={{ fontSize: 12 }}>✓ gesendet</span>}
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
            <textarea
              placeholder="Antwort verfassen… (wird erst nach Freigabe gesendet)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minHeight: 240, resize: "vertical" }}
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
                    setError(null);
                    setDrafting(true);
                    try {
                      const d = await draftReply(thread.id, c.body);
                      setText(d.text);
                      setAiHint(d.decision === "mensch" ? d.reason || "Bitte prüfen" : null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setDrafting(false);
                    }
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
                onClick={async () => {
                  setError(null);
                  setDrafting(true);
                  try {
                    const d = await draftReply(thread.id);
                    setText(d.text);
                    setAiHint(d.decision === "mensch" ? d.reason || "Bitte prüfen" : null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setDrafting(false);
                  }
                }}
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
                    await replyToThread(thread.id, text, fd);
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
