"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addDevTodo, toggleDevTodo, deleteDevTodo } from "@/server/actions/roadmap";
import { TODO_CATEGORIES } from "@/lib/roadmap";

type Todo = { id: string; title: string; category: string; status: string };

const CAT_COLOR: Record<string, string> = {
  Finance: "#3fb950", Reklamationen: "#d9a300", Integrationen: "#6f8cff",
  "Support/Inbox": "#b06fff", "Infra/Deploy": "#e5634d", Allgemein: "#9aa0ab",
};

function Item({ t, busy, onToggle, onDelete }: { t: Todo; busy: boolean; onToggle: () => void; onDelete: () => void }) {
  const done = t.status === "erledigt";
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
      <input type="checkbox" checked={done} disabled={busy} onChange={onToggle} style={{ width: 17, height: 17, flex: "0 0 auto", cursor: "pointer" }} />
      <span style={{ flex: 1, textDecoration: done ? "line-through" : "none", color: done ? "var(--muted)" : "var(--text)" }}>{t.title}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: CAT_COLOR[t.category] ?? "#9aa0ab", whiteSpace: "nowrap" }}>{t.category}</span>
      <button className="btnlink" disabled={busy} onClick={onDelete} title="Löschen" style={{ color: "var(--muted)" }}>✕</button>
    </li>
  );
}

export function RoadmapBoard({ todos }: { todos: Todo[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("Allgemein");
  const [busy, setBusy] = useState(false);

  const open = todos.filter((t) => t.status !== "erledigt");
  const done = todos.filter((t) => t.status === "erledigt");
  const pct = todos.length ? Math.round((done.length / todos.length) * 100) : 0;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); router.refresh(); } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Fortschritt */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
          <span><b>{done.length}</b> erledigt · <b>{open.length}</b> offen</span>
          <span className="muted">{pct} %</span>
        </div>
        <div style={{ height: 8, borderRadius: 5, background: "var(--panel-2)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "#3fb950" }} />
        </div>
      </div>

      {/* Hinzufügen */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; const tt = title; setTitle(""); run(() => addDevTodo(tt, category)); }}
        style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Neue Aufgabe…"
          style={{ flex: 1, minWidth: 220, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)" }} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="shopswitch" style={{ padding: "7px 8px" }}>
          {TODO_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="primary" type="submit" disabled={busy}>+ Hinzufügen</button>
      </form>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 320px" }}>
          <h3 style={{ margin: "0 0 6px" }}>🔧 Offen ({open.length})</h3>
          {open.length === 0 ? <p className="muted">Nichts offen. 🎉</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {open.map((t) => <Item key={t.id} t={t} busy={busy} onToggle={() => run(() => toggleDevTodo(t.id))} onDelete={() => run(() => deleteDevTodo(t.id))} />)}
            </ul>
          )}
        </div>
        <div style={{ flex: "1 1 320px" }}>
          <h3 style={{ margin: "0 0 6px" }}>✅ Erledigt ({done.length})</h3>
          {done.length === 0 ? <p className="muted">Noch nichts abgehakt.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {done.map((t) => <Item key={t.id} t={t} busy={busy} onToggle={() => run(() => toggleDevTodo(t.id))} onDelete={() => run(() => deleteDevTodo(t.id))} />)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
