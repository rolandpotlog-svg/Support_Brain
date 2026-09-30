"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addLesson, decideLesson } from "@/server/actions/lessons";
import { INTENTS } from "@/lib/support/intents";

export function LessonRow({ id, rule, status }: { id: string; rule: string; status: string }) {
  const router = useRouter();
  const [text, setText] = useState(rule);
  const [busy, setBusy] = useState(false);
  const go = async (s: "aktiv" | "verworfen" | "vorschlag") => {
    setBusy(true);
    try {
      await decideLesson(id, s, text);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="lesson-edit">
      <textarea id={`lesson-${id}`} rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="lesson-btns">
        {status !== "aktiv" && <button className="primary" disabled={busy} onClick={() => go("aktiv")}>Übernehmen</button>}
        {status === "aktiv" && text !== rule && <button className="primary" disabled={busy} onClick={() => go("aktiv")}>Speichern</button>}
        {status !== "verworfen" && <button disabled={busy} onClick={() => go("verworfen")}>{status === "aktiv" ? "Deaktivieren" : "Verwerfen"}</button>}
      </div>
    </div>
  );
}

export function AddLesson({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [rule, setRule] = useState("");
  const [intent, setIntent] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="lesson-add"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        try {
          await addLesson(shopId, rule, intent || null);
          setRule("");
          router.refresh();
        } catch (x) {
          setErr(x instanceof Error ? x.message : String(x));
        }
      }}
    >
      <textarea id="lesson-new" rows={2} placeholder="Eigene Regel, z. B. „Bei Box beschädigt immer zuerst ein Foto anfordern, dann kostenlosen Ersatz zusagen.“" value={rule} onChange={(e) => setRule(e.target.value)} />
      <div className="lesson-btns">
        <select id="lesson-intent" value={intent} onChange={(e) => setIntent(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">gilt für alle Anliegen</option>
          {INTENTS.map((i) => <option key={i.key} value={i.key}>nur: {i.label}</option>)}
        </select>
        <button className="primary" type="submit">Regel hinzufügen</button>
        {err && <span className="error">{err}</span>}
      </div>
    </form>
  );
}
