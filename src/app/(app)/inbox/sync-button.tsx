"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncMail } from "@/server/actions/sync";

export function SyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="syncwrap">
      <button
        className="icon-btn ghost"
        title="Mails abrufen & freigegebene Antworten senden"
        aria-label="Aktualisieren"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            try {
              const r = await syncMail();
              setMsg(`${r.fetched} geholt · ${r.sent} gesendet`);
              router.refresh();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        <span className={pending ? "spin" : ""}>⟳</span>
      </button>
      {msg && <span className="syncmsg muted">{msg}</span>}
    </div>
  );
}
