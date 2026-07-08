"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setFeedbackStatus, deleteFeedback } from "@/server/actions/feedback";

type Item = { id: string; kind: string; text: string; status: string; userEmail: string | null; createdAtISO: string };

export function FeedbackList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); router.refresh(); } finally { setBusy(false); }
  }
  if (items.length === 0) return <p className="muted" style={{ margin: 0 }}>Noch kein Feedback.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((f) => (
        <div key={f.id} className="card" style={{ margin: 0, padding: 12, opacity: f.status === "erledigt" ? 0.6 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{f.kind === "bug" ? "🐞 Problem" : f.kind === "gut" ? "👍 Läuft gut" : "💡 Idee"}</span>
            <span className="muted" style={{ fontSize: 11 }}>{f.userEmail ?? "?"} · {new Date(f.createdAtISO).toLocaleDateString("de-DE")}</span>
          </div>
          <div style={{ whiteSpace: "pre-wrap", margin: "6px 0", fontSize: 14 }}>{f.text}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btnlink" disabled={busy} onClick={() => run(() => setFeedbackStatus(f.id, f.status === "erledigt" ? "neu" : "erledigt"))}>
              {f.status === "erledigt" ? "↩ wieder offen" : "✓ erledigt"}
            </button>
            <button className="btnlink" disabled={busy} onClick={() => run(() => deleteFeedback(f.id))} style={{ color: "var(--tag-rose-fg)" }}>Löschen</button>
          </div>
        </div>
      ))}
    </div>
  );
}
