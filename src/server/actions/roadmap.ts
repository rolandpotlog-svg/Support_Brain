"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireOwner } from "@/server/access";
import { TODO_CATEGORIES } from "@/lib/roadmap";

export async function addDevTodo(title: string, category: string, status: "offen" | "erledigt" = "offen") {
  await requireOwner();
  const t = title.trim();
  if (!t) throw new Error("Titel fehlt");
  await db.insert(schema.devTodo).values({
    title: t,
    category: TODO_CATEGORIES.includes(category as (typeof TODO_CATEGORIES)[number]) ? category : "Allgemein",
    status,
    doneAt: status === "erledigt" ? new Date() : null,
  });
  revalidatePath("/roadmap");
}

export async function toggleDevTodo(id: string) {
  await requireOwner();
  const row = await db.query.devTodo.findFirst({ where: eq(schema.devTodo.id, id) });
  if (!row) return;
  const next = row.status === "erledigt" ? "offen" : "erledigt";
  await db.update(schema.devTodo).set({ status: next, doneAt: next === "erledigt" ? new Date() : null }).where(eq(schema.devTodo.id, id));
  revalidatePath("/roadmap");
}

export async function deleteDevTodo(id: string) {
  await requireOwner();
  await db.delete(schema.devTodo).where(eq(schema.devTodo.id, id));
  revalidatePath("/roadmap");
}
