"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  discardComment,
  escalateComment,
  hideCommentAction,
  postCommentReply,
  sendPrivateReply,
} from "@/server/actions/social-comments";

export function CommentActions({
  id,
  routeAction,
  draftText,
}: {
  id: string;
  routeAction: string | null;
  draftText: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(draftText ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ warn?: string } | void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await fn();
      if (r && "warn" in r && r.warn) setNote(r.warn);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const showDraft = routeAction === "public_reply" || routeAction === "private_or_human";

  return (
    <div style={{ marginTop: 8 }}>
      {showDraft && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{ width: "100%", boxSizing: "border-box" }}
          placeholder="Antwortentwurf…"
        />
      )}
      <div className="srcrow" style={{ marginTop: 6, flexWrap: "wrap" }}>
        {routeAction === "public_reply" && (
          <>
            <button className="btnlink primary" disabled={busy || !text.trim()} onClick={() => run(() => postCommentReply(id, text))}>
              Öffentlich posten
            </button>
            <button className="btnlink" disabled={busy || !text.trim()} onClick={() => run(() => sendPrivateReply(id, text))}>
              Stattdessen privat
            </button>
          </>
        )}
        {routeAction === "private_or_human" && (
          <>
            <button className="btnlink primary" disabled={busy || !text.trim()} onClick={() => run(() => sendPrivateReply(id, text))}>
              Privat senden (DM)
            </button>
            <button className="btnlink" disabled={busy} onClick={() => run(() => escalateComment(id))}>
              An Mensch eskalieren
            </button>
          </>
        )}
        {(routeAction === "hide" || routeAction === "public_reply" || routeAction === "private_or_human") && (
          <button className="btnlink" disabled={busy} onClick={() => run(() => hideCommentAction(id))}>
            Ausblenden
          </button>
        )}
        {routeAction === "skip" && (
          <button className="btnlink" disabled={busy} onClick={() => run(() => escalateComment(id))}>
            An Mensch
          </button>
        )}
        <button className="btnlink" disabled={busy} onClick={() => run(() => discardComment(id))}>
          Verwerfen
        </button>
      </div>
      {note && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{note}</div>}
      {error && <div className="formerror" style={{ marginTop: 4 }}>{error}</div>}
    </div>
  );
}
