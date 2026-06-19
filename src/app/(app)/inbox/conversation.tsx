"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { escalateThread, replyToThread, setThreadStatus } from "@/server/actions/inbox";
import { initials, timeAgo } from "@/lib/format";

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  createdAt: string;
};
type Thread = {
  id: string;
  subject: string | null;
  customerEmail: string;
  customerName: string | null;
  status: string;
};

export function Conversation({
  thread,
  messages,
  supportEmail,
}: {
  thread: Thread;
  messages: Msg[];
  supportEmail: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
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

  return (
    <section className="convo">
      <div className="chead">
        <h2>{thread.subject || "(kein Betreff)"}</h2>
        <button className="icon-btn ghost" title="Eskalieren" onClick={() => {
          const reason = window.prompt("Grund für die Eskalation an die Geschäftsführung?") ?? "";
          run(() => escalateThread(thread.id, reason));
        }}>⚑</button>
        <button
          className="green"
          disabled={pending}
          onClick={() => run(() => setThreadStatus(thread.id, "closed"))}
        >
          ✓ Schließen
        </button>
      </div>

      <div className="body">
        {error && <p className="error">{error}</p>}
        {messages.map((m) => (
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
        ))}
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
          <p className="muted">Interne Notizen kommen in einer späteren Phase.</p>
        )}
      </div>
    </section>
  );
}
