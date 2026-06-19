"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveShop, type ShopInput } from "@/server/actions/shops";
import { startShopifyOAuth } from "@/server/actions/shopify-oauth";
import { testConnection, type TestResult } from "@/server/actions/test-connection";
import type { ShopDetail } from "@/server/shop-config";

type Row = {
  id?: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  passwordsSet: boolean;
  _deleted?: boolean;
};

function blankRow(): Row {
  return {
    imapHost: "", imapPort: "993", imapUser: "", imapPassword: "",
    smtpHost: "", smtpPort: "465", smtpUser: "", smtpPassword: "",
    fromEmail: "", fromName: "", passwordsSet: false,
  };
}

function rowsFrom(initial: ShopDetail | null): Row[] {
  if (!initial || initial.mailboxes.length === 0) return [blankRow()];
  return initial.mailboxes.map((m) => ({
    id: m.id,
    imapHost: m.imapHost, imapPort: String(m.imapPort), imapUser: m.imapUser, imapPassword: "",
    smtpHost: m.smtpHost, smtpPort: String(m.smtpPort), smtpUser: m.smtpUser, smtpPassword: "",
    fromEmail: m.fromEmail, fromName: m.fromName ?? "", passwordsSet: m.passwordsSet,
  }));
}

export function ShopForm({ initial, hideHead }: { initial: ShopDetail | null; hideHead?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [shopifyDomain, setShopifyDomain] = useState(initial?.shopify.domain ?? "");
  const [shopifyClientId, setShopifyClientId] = useState(initial?.shopify.clientId ?? "");
  const [shopifyClientSecret, setShopifyClientSecret] = useState("");
  const [shopifyToken, setShopifyToken] = useState("");
  const [rows, setRows] = useState<Row[]>(rowsFrom(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  function patch(i: number, p: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) =>
      rs[i].id
        ? rs.map((r, idx) => (idx === i ? { ...r, _deleted: true } : r))
        : rs.filter((_, idx) => idx !== i),
    );
  }

  function save() {
    setError(null);
    const input: ShopInput = {
      id: initial?.id,
      name,
      active,
      shopifyDomain,
      shopifyClientId,
      shopifyClientSecret,
      shopifyToken,
      mailboxes: rows.map((r) => ({
        id: r.id,
        delete: r._deleted,
        imapHost: r.imapHost,
        imapPort: Number(r.imapPort) || 993,
        imapUser: r.imapUser,
        imapPassword: r.imapPassword,
        smtpHost: r.smtpHost,
        smtpPort: Number(r.smtpPort) || 465,
        smtpUser: r.smtpUser,
        smtpPassword: r.smtpPassword,
        fromEmail: r.fromEmail,
        fromName: r.fromName,
      })),
    };
    startTransition(async () => {
      try {
        await saveShop(input);
        router.push("/admin/shops");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function runTest() {
    if (!initial?.id) return;
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await testConnection(initial.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  const visibleRows = rows.map((r, i) => ({ r, i })).filter((x) => !x.r._deleted);

  return (
    <div className="shopform">
      {!hideHead && (
        <div className="formhead">
          <Link href="/admin/shops" className="back">← Shops</Link>
          <h1>{initial ? `Shop bearbeiten: ${initial.name}` : "Shop hinzufügen"}</h1>
        </div>
      )}

      {error && <div className="formerror">{error}</div>}

      <section className="card">
        <h2>Stammdaten</h2>
        <div className="invite">
          <input placeholder="Anzeigename (z. B. Repello)" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="chk">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Aktiv (wird gepollt &amp; im Umschalter gezeigt)
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Shopify-Zugang</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {initial?.shopify.configured
            ? `Verbunden (${initial.shopify.clientId ? "Client-Credentials" : "Legacy-Token"}). Das Tool holt den Token selbst.`
            : "Client-Credentials-Grant: Client-ID + Secret aus der Dev-Dashboard-App. Das Tool holt den Admin-API-Token automatisch (verschlüsselt gespeichert)."}
        </p>
        <div className="invite">
          <input
            placeholder="store.myshopify.com (z. B. repello-1157.myshopify.com)"
            value={shopifyDomain}
            onChange={(e) => setShopifyDomain(e.target.value)}
          />
          <input
            placeholder="Client-ID"
            value={shopifyClientId}
            onChange={(e) => setShopifyClientId(e.target.value)}
          />
          <input
            type="password"
            placeholder={initial?.shopify.hasClientSecret ? "Client Secret (leer = behalten)" : "Client Secret"}
            value={shopifyClientSecret}
            onChange={(e) => setShopifyClientSecret(e.target.value)}
          />
          <details>
            <summary className="muted" style={{ fontSize: 12, cursor: "pointer" }}>
              Alternative: Legacy Admin-API-Token (shpat_…)
            </summary>
            <input
              type="password"
              style={{ marginTop: 8, width: "100%" }}
              placeholder={initial?.shopify.hasLegacyToken ? "Token (leer = behalten)" : "shpat_… (nur falls keine Client-ID)"}
              value={shopifyToken}
              onChange={(e) => setShopifyToken(e.target.value)}
            />
          </details>
          <span className="muted" style={{ fontSize: 12 }}>
            Scopes werden im Dev Dashboard gesetzt. Domain leer lassen entfernt die Verbindung.
          </span>
          {initial && initial.shopify.clientId && (
            <div className="srcrow" style={{ marginTop: 4 }}>
              <form action={startShopifyOAuth.bind(null, initial.id)}>
                <button className="btnlink" type="submit">
                  {initial.shopify.hasLegacyToken ? "Shopify neu autorisieren" : "Mit Shopify verbinden (autorisieren)"}
                </button>
              </form>
              <span className="muted" style={{ fontSize: 12 }}>
                {initial.shopify.hasLegacyToken
                  ? "✓ autorisiert"
                  : "Zuerst speichern, dann hier autorisieren — installiert die App im Store."}
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>E-Mail-Postfächer</h2>
          <button type="button" className="ghost" onClick={addRow}>+ Postfach hinzufügen</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Mehrere möglich (z. B. support@ und info@). IMAP = eingehend, SMTP = ausgehend.
        </p>

        {visibleRows.length === 0 && <p className="muted">Kein Postfach. „+ Postfach hinzufügen".</p>}

        {visibleRows.map(({ r, i }) => (
          <div className="mailbox" key={r.id ?? `new-${i}`}>
            <div className="mbhead">
              <strong>{r.fromEmail || "Neues Postfach"}</strong>
              <button type="button" className="warn ghost" onClick={() => removeRow(i)}>entfernen</button>
            </div>
            <div className="row">
              <input placeholder="Absender-E-Mail (z. B. support@…)" value={r.fromEmail} onChange={(e) => patch(i, { fromEmail: e.target.value })} />
              <input placeholder="Absender-Name (optional)" value={r.fromName} onChange={(e) => patch(i, { fromName: e.target.value })} />
            </div>
            <div className="mblabel">Eingehend (IMAP)</div>
            <div className="row">
              <input placeholder="IMAP-Server" value={r.imapHost} onChange={(e) => patch(i, { imapHost: e.target.value })} />
              <input placeholder="Port" style={{ maxWidth: 90 }} value={r.imapPort} onChange={(e) => patch(i, { imapPort: e.target.value })} />
            </div>
            <div className="row">
              <input placeholder="IMAP-Login" value={r.imapUser} onChange={(e) => patch(i, { imapUser: e.target.value })} />
              <input type="password" placeholder={r.passwordsSet ? "Passwort (leer = behalten)" : "IMAP-Passwort"} value={r.imapPassword} onChange={(e) => patch(i, { imapPassword: e.target.value })} />
            </div>
            <div className="mblabel">Ausgehend (SMTP)</div>
            <div className="row">
              <input placeholder="SMTP-Server" value={r.smtpHost} onChange={(e) => patch(i, { smtpHost: e.target.value })} />
              <input placeholder="Port" style={{ maxWidth: 90 }} value={r.smtpPort} onChange={(e) => patch(i, { smtpPort: e.target.value })} />
            </div>
            <div className="row">
              <input placeholder="SMTP-Login" value={r.smtpUser} onChange={(e) => patch(i, { smtpUser: e.target.value })} />
              <input type="password" placeholder={r.passwordsSet ? "Passwort (leer = behalten)" : "SMTP-Passwort"} value={r.smtpPassword} onChange={(e) => patch(i, { smtpPassword: e.target.value })} />
            </div>
          </div>
        ))}
      </section>

      <div className="formactions">
        <button className="primary" disabled={pending} onClick={save}>
          {pending ? "Speichert…" : "Speichern"}
        </button>
        {initial?.id && (
          <button className="ghost" disabled={testing} onClick={runTest}>
            {testing ? "Teste…" : "Verbindung testen"}
          </button>
        )}
        <Link href="/admin/shops" className="muted" style={{ alignSelf: "center" }}>Abbrechen</Link>
      </div>

      {initial?.id && (
        <p className="muted" style={{ fontSize: 12 }}>
          „Verbindung testen" prüft die <b>gespeicherten</b> Zugangsdaten — also erst speichern, dann testen.
        </p>
      )}

      {test && (
        <section className="card">
          <h2>Testergebnis</h2>
          {test.shopify && (
            <div className={`testline ${test.shopify.ok ? "ok" : "bad"}`}>
              <span className="dot" /> <b>Shopify:</b> {test.shopify.detail}
            </div>
          )}
          {!test.shopify && <div className="muted">Shopify: nicht konfiguriert.</div>}
          {test.mailboxes.length === 0 && <div className="muted">Keine Postfächer gespeichert.</div>}
          {test.mailboxes.map((m) => (
            <div key={m.fromEmail} style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600 }}>{m.fromEmail}</div>
              <div className={`testline ${m.imap.ok ? "ok" : "bad"}`}><span className="dot" /> IMAP: {m.imap.detail}</div>
              <div className={`testline ${m.smtp.ok ? "ok" : "bad"}`}><span className="dot" /> SMTP: {m.smtp.detail}</div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
