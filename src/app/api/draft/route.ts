// KI-Entwurf live (Text erscheint beim Schreiben). Antwort = NDJSON-Zeilen:
//   {"t":"delta","v":"…"}  Text-Stück der Mail
//   {"t":"done","text":"…","decision":"auto|mensch","reason":"…"}  fertiger Entwurf inkl. Signatur
//   {"t":"check", …DraftCheck}  Ergebnis der Prüfung (kommt ein paar Sekunden später)
//   {"t":"error","error":"…"}
// Schreibt der Worker gerade denselben Entwurf, wird auf dessen Ergebnis gewartet (keine doppelten Kosten).
import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { requireUser, requireWrite } from "@/server/access";
import { completeStream } from "@/server/ai";
import { finishDraft, prepareDraft, runCheck } from "@/server/ai/draft";
import { claimDrafting, releaseDrafting } from "@/server/ai/draft-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EFFORT = (process.env.DRAFT_EFFORT as "low" | "medium" | "high" | undefined) ?? "medium";

export async function POST(req: Request) {
  const { threadId, intent, onlyIfMissing } = (await req.json().catch(() => ({}))) as { threadId?: string; intent?: string; onlyIfMissing?: boolean };
  // Erst Login prüfen (verrät sonst, ob es ein Ticket gibt)
  try {
    await requireUser();
  } catch {
    return new Response("Nicht angemeldet", { status: 401 });
  }
  if (!threadId) return new Response("threadId fehlt", { status: 400 });
  const thread = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
  if (!thread) return new Response("Ticket nicht gefunden", { status: 404 });
  try {
    await requireWrite(thread.shopId, "support");
  } catch {
    return new Response("Kein Zugriff", { status: 403 });
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      let claimed = false;
      try {
        claimed = await claimDrafting(threadId);
        if (!claimed) {
          // Worker entwirft gerade -> bis zu 90 s auf sein Ergebnis warten
          const startedAt = Date.now();
          while (Date.now() - startedAt < 90_000) {
            await new Promise((r) => setTimeout(r, 1000));
            const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
            if (!t?.aiDraftingAt) {
              send({ t: "done", text: t?.lastAiDraft ?? "", decision: t?.aiDecision ?? "mensch", reason: t?.aiReason ?? "" });
              if (t?.aiCheck) send({ t: "check", ...t.aiCheck });
              return;
            }
          }
          send({ t: "error", error: "Entwurf dauert ungewöhnlich lange — bitte gleich nochmal versuchen." });
          return;
        }
        // Beim automatischen Start (Ticket geöffnet): nichts tun, wenn inzwischen ein aktueller Entwurf da ist
        if (onlyIfMissing) {
          const t = await db.query.threads.findFirst({ where: eq(schema.threads.id, threadId) });
          if (t?.lastAiDraft && t.aiDraftAt && t.aiDraftAt >= t.lastMessageAt) {
            send({ t: "done", text: t.lastAiDraft, decision: t.aiDecision ?? "mensch", reason: t.aiReason ?? "" });
            if (t.aiCheck) send({ t: "check", ...t.aiCheck });
            return;
          }
        }

        const prep = await prepareDraft(threadId, intent);
        // Nur den Teil <antwort>…</antwort> live zeigen (Entscheidung/Grund kommen am Ende).
        let buf = "";
        let emitted = 0;
        let inAnswer = false;
        let first = true;
        const raw = await completeStream(
          { system: prep.system, messages: [{ role: "user", content: prep.userMsg }], maxTokens: 8000, effort: EFFORT, kind: "entwurf", shopId: prep.shopId, cacheTtl: "1h" },
          (delta) => {
            buf += delta;
            if (!inAnswer) {
              const i = buf.indexOf("<antwort>");
              if (i < 0) return;
              inAnswer = true;
              emitted = i + "<antwort>".length;
            }
            const end = buf.indexOf("</antwort>", emitted);
            // die letzten 10 Zeichen zurückhalten (könnten der Anfang von </antwort> sein)
            const upto = end >= 0 ? end : Math.max(emitted, buf.length - 10);
            if (upto > emitted) {
              const piece = buf.slice(emitted, upto);
              emitted = upto;
              const v = first ? piece.replace(/^\s+/, "") : piece;
              first = first && v === "";
              if (v) send({ t: "delta", v });
            }
          },
        );
        const d = await finishDraft(threadId, prep, raw);
        claimed = false; // finishDraft hat die Sperre gelöst
        send({ t: "done", text: d.text, decision: d.decision, reason: d.reason });
        const check = await runCheck(threadId, prep, d);
        if (check) send({ t: "check", ...check });
      } catch (e) {
        send({ t: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (claimed) await releaseDrafting(threadId);
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
