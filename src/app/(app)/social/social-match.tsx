"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  findSocialCandidates,
  linkSocialCustomer,
  unlinkSocialCustomer,
} from "@/server/actions/social";
import type { ShopifyCustomer } from "@/lib/shopify/client";
import { initials } from "@/lib/format";

export function SocialMatch({
  convId,
  customerName,
  customerEmail,
}: {
  convId: string;
  customerName: string | null;
  customerEmail: string | null;
}) {
  const router = useRouter();
  const [cands, setCands] = useState<ShopifyCustomer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (customerName) {
    return (
      <div className="sec">
        <div className="sec-label">Zugeordnet</div>
        <div className="cname">{customerName}</div>
        {customerEmail && <div className="cmail">{customerEmail}</div>}
        <button
          className="candidate"
          style={{ marginTop: 10 }}
          onClick={async () => {
            await unlinkSocialCustomer(convId);
            router.refresh();
          }}
        >
          Verknüpfung lösen
        </button>
      </div>
    );
  }

  return (
    <div className="sec">
      <div className="note">
        Kein Kunde zugeordnet. Meta liefert meist keine E-Mail — Abgleich über den Namen.
        Niemals stillschweigend zuordnen.
      </div>
      {error && <p className="error">{error}</p>}
      <button
        className="candidate"
        style={{ marginTop: 10 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setCands(await findSocialCandidates(convId));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sucht…" : "Kunde suchen (über Namen)"}
      </button>
      {cands && cands.length === 0 && <p className="muted">Keine Treffer.</p>}
      {cands?.map((c) => (
        <button
          key={c.id}
          className="candidate"
          onClick={async () => {
            await linkSocialCustomer(convId, c);
            router.refresh();
          }}
        >
          <div className="cav">{initials(c.displayName, c.email ?? "?")}</div>
          <div style={{ minWidth: 0 }}>
            <div className="cname">{c.displayName}</div>
            <div className="cmail">{c.email} · {c.numberOfOrders} Best.</div>
          </div>
        </button>
      ))}
    </div>
  );
}
