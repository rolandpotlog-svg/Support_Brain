"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCannedReply, deleteCannedReply } from "@/server/actions/canned";

type Item = { id: string; title: string; body: string };

export function CannedManage({ shopId, items }: { shopId: string; items: Item[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await createCannedReply(shopId, title, body);
      setTitle(""); setBody("");
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Baustein löschen?")) return;
    setBusy(true);
    try { await deleteCannedReply(id); router.refresh(); } finally { setBusy(false); }
  }

  const fld: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14 };

  return (
    <div>
      <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
        <input style={fld} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel (z. B. Sendungsverfolgung)" />
        <textarea style={{ ...fld, resize: "vertical" }} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Text des Bausteins…" />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="primary" type="submit" disabled={busy || !title.trim() || !body.trim()}>+ Baustein speichern</button>
          {err && <span className="formerror" style={{ margin: 0 }}>{err}</span>}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Noch keine Bausteine.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((c) => (
            <div key={c.id} className="card" style={{ margin: 0, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <b>{c.title}</b>
                <button className="btnlink" onClick={() => remove(c.id)} style={{ color: "var(--tag-rose-fg)" }}>Löschen</button>
              </div>
              <div className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 4, fontSize: 13.5 }}>{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
