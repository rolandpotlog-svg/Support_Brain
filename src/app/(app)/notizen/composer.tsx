"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitFeedback } from "@/server/actions/feedback";

const KINDS = [
  { key: "gut", label: "👍 Läuft gut" },
  { key: "bug", label: "🐞 Problem" },
  { key: "idee", label: "💡 Idee" },
] as const;

export function NotesComposer() {
  const router = useRouter();
  const [kind, setKind] = useState<"gut" | "bug" | "idee">("gut");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await submitFeedback(kind, text);
      setText("");
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="seg" style={{ marginBottom: 10 }}>
        {KINDS.map((k) => (
          <a key={k.key} className={kind === k.key ? "on" : ""} style={{ cursor: "pointer" }} onClick={() => setKind(k.key)}>
            {k.label}
          </a>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Was läuft gut? Was hakt? Was wäre sinnvoll zu bauen?"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--panel-2)",
          color: "var(--text)",
          fontFamily: "inherit",
          fontSize: 14,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button className="primary" disabled={busy || !text.trim()} onClick={send}>
          {busy ? "Speichert…" : "+ Notiz speichern"}
        </button>
        {done && <span className="ok-text">✓ Gespeichert, danke!</span>}
        {err && <span className="formerror" style={{ margin: 0 }}>{err}</span>}
      </div>
    </div>
  );
}
