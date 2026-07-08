import { desc } from "drizzle-orm";
import { requireUser } from "@/server/access";
import { db, schema } from "@/server/db";
import { timeAgo } from "@/lib/format";
import { NotesComposer } from "./composer";

const KIND_META: Record<string, { label: string; cls: string }> = {
  gut: { label: "👍 Läuft gut", cls: "green" },
  bug: { label: "🐞 Problem", cls: "rose" },
  idee: { label: "💡 Idee", cls: "amber" },
};

export default async function NotizenPage() {
  await requireUser();
  const notes = await db
    .select({
      id: schema.feedback.id,
      kind: schema.feedback.kind,
      text: schema.feedback.text,
      status: schema.feedback.status,
      userEmail: schema.feedback.userEmail,
      createdAt: schema.feedback.createdAt,
    })
    .from(schema.feedback)
    .orderBy(desc(schema.feedback.createdAt))
    .limit(50);

  return (
    <div className="adminwrap">
      <h1 style={{ marginTop: 0 }}>📝 Team-Notizen</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Halt fest, was gut läuft, was hakt und was noch sinnvoll wäre zu bauen. Der Owner sieht alle Notizen.
      </p>

      <NotesComposer />

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        {notes.length === 0 ? (
          <p className="muted">Noch keine Notizen — schreib die erste oben rein.</p>
        ) : (
          notes.map((n) => {
            const m = KIND_META[n.kind] ?? KIND_META.idee;
            return (
              <div
                key={n.id}
                className="card"
                style={{ margin: 0, padding: 12, opacity: n.status === "erledigt" ? 0.55 : 1 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className={`fbadge ${m.cls}`}>{m.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {n.userEmail ?? "?"} · {timeAgo(new Date(n.createdAt))}
                    {n.status === "erledigt" ? " · erledigt ✓" : ""}
                  </span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{n.text}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
