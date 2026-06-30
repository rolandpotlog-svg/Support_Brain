// Interne Roadmap/ToDo-Seite (Owner-only): Build-Fortschritt abhaken + Offenes pflegen.
import { redirect } from "next/navigation";
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/access";
import { RoadmapBoard } from "./board";
import { FeedbackList } from "./feedback-list";

export default async function RoadmapPage() {
  const user = await requireUser();
  if (!user.isOwner) redirect("/inbox");

  const rows = await db
    .select({ id: schema.devTodo.id, title: schema.devTodo.title, category: schema.devTodo.category, status: schema.devTodo.status })
    .from(schema.devTodo)
    .orderBy(asc(schema.devTodo.category), asc(schema.devTodo.createdAt));

  const fb = await db
    .select({ id: schema.feedback.id, kind: schema.feedback.kind, text: schema.feedback.text, status: schema.feedback.status, userEmail: schema.feedback.userEmail, createdAt: schema.feedback.createdAt })
    .from(schema.feedback)
    .orderBy(desc(schema.feedback.createdAt));
  const feedbackItems = fb.map((f) => ({ ...f, createdAtISO: f.createdAt.toISOString() }));
  const openFb = feedbackItems.filter((f) => f.status !== "erledigt").length;

  return (
    <div className="adminwrap">
      <div className="formhead"><h1 style={{ margin: 0 }}>🛠 Roadmap / ToDos</h1></div>
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Interner Build-Überblick — Erledigtes abhaken, Offenes ergänzen. Nur für dich (Owner) sichtbar.
        </p>
        <RoadmapBoard todos={rows} />
      </section>
      <section className="card">
        <h2 style={{ marginTop: 0 }}>💬 Feedback vom Team {openFb > 0 && <span style={{ fontSize: 13, color: "var(--accent)" }}>· {openFb} neu</span>}</h2>
        <p className="muted" style={{ marginTop: 0 }}>Ideen &amp; Bugs, die Mitarbeiter über den 💡-Button melden.</p>
        <FeedbackList items={feedbackItems} />
      </section>
    </div>
  );
}
