"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/server/db";
import { accessibleShopIds, requireUser, requireOwner } from "@/server/access";
import { getActiveShopId } from "@/server/active-shop";

/** Notiz/Feedback von einem Mitarbeiter (jeder eingeloggte Nutzer). gut=läuft, bug=Problem, idee=Vorschlag. */
export async function submitFeedback(kind: "gut" | "bug" | "idee", text: string) {
  const user = await requireUser();
  const t = text.trim();
  if (!t) throw new Error("Bitte etwas eintragen");
  const k = kind === "gut" || kind === "bug" ? kind : "idee";
  // Notiz dem aktiven Shop zuordnen -> Mitarbeiter anderer Shops sehen sie nicht.
  const shopId = await getActiveShopId(await accessibleShopIds(user));
  await db.insert(schema.feedback).values({
    shopId,
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
