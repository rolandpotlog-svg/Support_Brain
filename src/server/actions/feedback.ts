"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireUser, requireOwner } from "@/server/access";

/** Feedback/Idee von einem Mitarbeiter (jeder eingeloggte Nutzer). */
export async function submitFeedback(kind: "idee" | "bug", text: string) {
  const user = await requireUser();
  const t = text.trim();
  if (!t) throw new Error("Bitte etwas eintragen");
  await db.insert(schema.feedback).values({
    userId: user.id,
    userEmail: user.email,
    kind: kind === "bug" ? "bug" : "idee",
    text: t,
  });
}

/** Owner: Feedback als erledigt/neu markieren oder löschen. */
export async function setFeedbackStatus(id: string, status: "neu" | "erledigt") {
  await requireOwner();
  await db.update(schema.feedback).set({ status }).where(eq(schema.feedback.id, id));
  revalidatePath("/roadmap");
}

export async function deleteFeedback(id: string) {
  await requireOwner();
  await db.delete(schema.feedback).where(eq(schema.feedback.id, id));
  revalidatePath("/roadmap");
}
