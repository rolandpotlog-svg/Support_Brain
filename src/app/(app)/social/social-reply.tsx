"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendSocialReply } from "@/server/actions/social";

export function SocialReply({
  convId,
  userName,
  withinWindow,
}: {
  convId: string;
  userName: string | null;
  withinWindow: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="editor">
      {!withinWindow && (
        <p className="note">
          Außerhalb des 24-Stunden-Fensters — freie Antworten sind bei Meta eingeschränkt
          (nur Message-Tags). Bitte Richtlinien beachten.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <textarea
        placeholder="Antwort verfassen… (Draft-First — wird erst auf Klick gesendet)"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="actions">
        <button
          disabled={pending}
          onClick={() => setText(`Hallo ${userName?.split(" ")[0] ?? ""}, danke für deine Nachricht! `)}
          title="Deterministischer Entwurf (KI folgt in Phase B)"
        >
          Entwurf
        </button>
        <span className="spacer" />
        <button
          className="primary"
          disabled={pending || !text.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await sendSocialReply(convId, text);
                setText("");
                router.refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            });
          }}
        >
          {pending ? "Sendet…" : "Senden"}
        </button>
      </div>
    </div>
  );
}
