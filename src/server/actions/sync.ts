"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/access";
import { ingestAll } from "../../../worker/imap";
import { processOutbox } from "../../../worker/smtp";

/** Manuelles Sync: neue Mails abrufen (IMAP) + freigegebene Antworten senden (SMTP).
 *  Dieselbe Logik wie der Hintergrund-Worker, nur auf Knopfdruck aus der UI. */
export async function syncMail(): Promise<{ fetched: number; sent: number }> {
  await requireUser();
  const fetched = await ingestAll();
  const sent = await processOutbox();
  revalidatePath("/inbox");
  return { fetched, sent };
}
