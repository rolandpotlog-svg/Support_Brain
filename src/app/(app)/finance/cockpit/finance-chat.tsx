"use client";
import { useEffect, useRef, useState } from "react";
import { askFinanceAssistant } from "@/server/actions/finance";

type Msg = { role: "user" | "assistant"; content: string };

const EXAMPLES = [
  "Warum ist die schlechteste Woche rot?",
  "Wo ist die Rabattquote am höchsten und was kostet uns das?",
  "Zerlege die Produktkosten der letzten abgeschlossenen Woche.",
  "Welche Woche war am profitabelsten und warum?",
];

export function FinanceChat({ shopId }: { shopId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: question }];
    setMsgs(next); setInput(""); setBusy(true); setError(null);
    try {
      const a = await askFinanceAssistant(shopId, next);
      setMsgs([...next, { role: "assistant", content: a }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>💬 Finance-Assistent <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>· antwortet nur aus deinen echten Zahlen — keine Erfindungen</span></h2>

      <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
        {msgs.length === 0 && <p className="muted" style={{ margin: 0 }}>Frag mich etwas zu deinen Finanzen — ich zerlege es mit den echten Zahlen.</p>}
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
            <div style={{
              padding: "9px 12px", borderRadius: 12, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5,
              background: m.role === "user" ? "var(--accent)" : "var(--panel-2)",
              color: m.role === "user" ? "#fff" : "var(--text)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
            }}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="muted" style={{ fontSize: 13 }}>denkt nach… 🧮</div>}
        {error && <div className="formerror" style={{ margin: 0 }}>{error}</div>}
        <div ref={endRef} />
      </div>

      {msgs.length === 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
          {EXAMPLES.map((q) => (
            <button key={q} className="btnlink" style={{ fontSize: 12 }} onClick={() => ask(q)} disabled={busy}>{q}</button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder="z. B. Warum haben wir bei den Produktkosten eine Abweichung?"
          rows={2}
          style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)", color: "var(--text)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
        />
        <button className="primary" onClick={() => ask(input)} disabled={busy || !input.trim()} style={{ alignSelf: "stretch" }}>Senden</button>
      </div>
    </section>
  );
}
