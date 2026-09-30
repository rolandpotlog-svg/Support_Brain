"use client";
// Neuer Mitarbeiter in einem Schritt: E-Mail, Name, Shop(s), Rolle — Passwort wird erzeugt.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createStaff } from "@/server/actions/admin";

const ROLES: { key: string; label: string; hint: string }[] = [
  { key: "mitarbeiter", label: "Mitarbeiter", hint: "Posteingang, Antworten, Retouren, Reklamationen — Standard für Support" },
  { key: "admin", label: "Admin", hint: "wie Mitarbeiter + Auswertung, Fälle, Shop-Einstellungen" },
  { key: "founder", label: "Founder", hint: "wie Admin (Inhaber des Shops)" },
  { key: "gast", label: "Gast", hint: "nur lesen, kann nichts senden oder ändern" },
];

export function NewStaffForm({ shops, defaultShopId }: { shops: { id: string; name: string }[]; defaultShopId: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("mitarbeiter");
  const [sel, setSel] = useState<string[]>(defaultShopId ? [defaultShopId] : []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ err?: string; pw?: string; who?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await createStaff({ email, name, shopIds: sel, role });
      if (!r.ok) setMsg({ err: r.error });
      else {
        setMsg({ pw: r.password, who: email });
        setEmail("");
        setName("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="staffform">
      <div className="row">
        <input id="staff-email" type="email" required placeholder="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input id="staff-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="staff-label">Shop(s)</div>
      <div className="staff-chips">
        {shops.map((s) => (
          <label key={s.id} className={`qchip ${sel.includes(s.id) ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={sel.includes(s.id)}
              onChange={(e) => setSel((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))}
              style={{ display: "none" }}
            />
            {s.name}
          </label>
        ))}
      </div>
      <div className="staff-label">Rolle</div>
      <div className="staff-roles">
        {ROLES.map((r) => (
          <label key={r.key} className={`staff-role ${role === r.key ? "on" : ""}`}>
            <input type="radio" name="staff-role" checked={role === r.key} onChange={() => setRole(r.key)} />
            <span><b>{r.label}</b><br /><span className="muted">{r.hint}</span></span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Legt an…" : "Mitarbeiter anlegen"}</button>
        {msg?.err && <span className="error">{msg.err}</span>}
      </div>
      {msg?.pw && (
        <div className="alertbar ok" style={{ marginTop: 10 }}>
          ✓ Login für <b>{msg.who}</b> angelegt. Start-Passwort (nur jetzt sichtbar, bitte weitergeben):{" "}
          <code style={{ userSelect: "all", fontWeight: 700 }}>{msg.pw}</code>
        </div>
      )}
    </form>
  );
}
