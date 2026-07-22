// Anhang ausliefern (Bild-Vorschau / Download) — nur für eingeloggte Nutzer mit Shop-Zugriff.
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { assertShopAccess, requireUser } from "@/server/access";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Nicht eingeloggt", { status: 401 });
  }

  const att = await db.query.messageAttachment.findFirst({ where: eq(schema.messageAttachment.id, id) });
  if (!att) return new Response("Nicht gefunden", { status: 404 });
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, att.messageId) });
  const thread = msg ? await db.query.threads.findFirst({ where: eq(schema.threads.id, msg.threadId) }) : null;
  if (!thread) return new Response("Nicht gefunden", { status: 404 });
  try {
    await assertShopAccess(user, thread.shopId);
  } catch {
    return new Response("Kein Zugriff", { status: 403 });
  }

  const safeName = att.filename.replace(/["\r\n]/g, "");
  return new Response(new Uint8Array(att.content), {
    headers: {
      "Content-Type": att.contentType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
