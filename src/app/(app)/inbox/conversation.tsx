"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addNote,
  assignThread,
  escalateThread,
  replyToThread,
  setThreadStatus,
  setThreadTag,
} from "@/server/actions/inbox";
import { initials, timeAgo } from "@/lib/format";

const TAG_PRESETS = ["Bestellstatus", "Beschädigte Ware", "Retoure/Umtausch", "Sonstiges"];

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  internal: boolean;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  createdAt: string;
};
type Assignee = { id: string; name: string | null; email: string };
type Thread = {
  id: string;
  subject: string | null;
  customerEmail: string;
  customerName: string | null;
  status: string;
  assigneeId: string | null;
  tag: string | null;
};

export function Conversation({
  thread,
  messages,
  supportEmail,
  assignees,
}: {
  thread: Thread;
  messages: Msg[];
  supportEmail: string;
  assignees: Assignee[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
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

  return (
    <section className="convo">
      <div className="chead">
        <h2>{thread.subject || "(kein Betreff)"}</h2>
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
      </div>

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
            <textarea
              placeholder="Antwort verfassen… (wird erst nach Freigabe gesendet)"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="actions">
              <span className="spacer" />
              <button
                className="primary"
                disabled={pending || !text.trim()}
                onClick={() =>
                  run(async () => {
                    await replyToThread(thread.id, text);
                    setText("");
                  })
                }
              >
                {pending ? "Sendet…" : "Antwort freigeben & senden"}
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
