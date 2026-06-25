// Interne Roadmap/ToDo-Seite (Owner-only): Build-Fortschritt abhaken + Offenes pflegen.
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser } from "@/server/access";
import { RoadmapBoard } from "./board";

export default async function RoadmapPage() {
  const user = await requireUser();
  if (!user.isOwner) redirect("/inbox");

  const rows = await db
    .select({ id: schema.devTodo.id, title: schema.devTodo.title, category: schema.devTodo.category, status: schema.devTodo.status })
    .from(schema.devTodo)
    .orderBy(asc(schema.devTodo.category), asc(schema.devTodo.createdAt));

  return (
    <div className="adminwrap">
      <div className="formhead"><h1 style={{ margin: 0 }}>🛠 Roadmap / ToDos</h1></div>
      <section className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Interner Build-Überblick — Erledigtes abhaken, Offenes ergänzen. Nur für dich (Owner) sichtbar.
        </p>
        <RoadmapBoard todos={rows} />
      </section>
    </div>
  );
}
