"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.error) {
      setError("E-Mail oder Passwort falsch.");
    } else {
      router.push("/inbox");
      router.refresh();
    }
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1 style={{ margin: 0 }}>Support-Brain</h1>
        <p className="muted" style={{ margin: 0 }}>Interner Support-Login</p>
        <label>
          E-Mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
