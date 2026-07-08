"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { requireUser, requireOwner } from "@/server/access";

/** Notiz/Feedback von einem Mitarbeiter (jeder eingeloggte Nutzer). gut=läuft, bug=Problem, idee=Vorschlag. */
export async function submitFeedback(kind: "gut" | "bug" | "idee", text: string) {
  const user = await requireUser();
  const t = text.trim();
  if (!t) throw new Error("Bitte etwas eintragen");
  const k = kind === "gut" || kind === "bug" ? kind : "idee";
  await db.insert(schema.feedback).values({
    userId: user.id,
    userEmail: user.email,
    kind: k,
    text: t,
  });
  revalidatePath("/notizen");
  revalidatePath("/roadmap");
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
