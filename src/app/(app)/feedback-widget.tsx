"use client";
import { useState } from "react";
import { submitFeedback } from "@/server/actions/feedback";

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"idee" | "bug">("idee");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      await submitFeedback(kind, text);
      setDone(true); setText("");
      setTimeout(() => { setOpen(false); setDone(false); }, 1600);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <button className="fab" onClick={() => setOpen((o) => !o)} title="Feedback / Idee melden" aria-label="Feedback">💡</button>
      {open && (
        <div className="fab-panel">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Feedback / Idee 💡</div>
          {done ? (
            <div className="ok-text" style={{ padding: "8px 0" }}>✓ Danke! Gespeichert.</div>
          ) : (
            <>
              <div className="seg" style={{ marginBottom: 8 }}>
                <a className={kind === "idee" ? "on" : ""} onClick={() => setKind("idee")} style={{ cursor: "pointer" }}>💡 Idee</a>
                <a className={kind === "bug" ? "on" : ""} onClick={() => setKind("bug")} style={{ cursor: "pointer" }}>🐞 Bug</a>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder={kind === "bug" ? "Was funktioniert nicht?" : "Deine Idee / Wunsch…"}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
              />
              {err && <div className="formerror" style={{ marginTop: 6 }}>{err}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button className="btnlink" onClick={() => setOpen(false)}>Abbrechen</button>
                <button className="primary" onClick={send} disabled={busy || !text.trim()}>{busy ? "Sendet…" : "Senden"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
