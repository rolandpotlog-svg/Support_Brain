"use client";
import { useState, useTransition } from "react";
import {
  refreshShopifyProfile,
  refreshWebsiteProfile,
  saveProfile,
} from "@/server/actions/profile";
import type { ProfileView } from "@/server/profile";
import {
  buildSystemPrompt,
  type FaqItem,
  type FieldSource,
  type ProfileData,
  type ProfileSources,
} from "@/lib/profile/types";

const BADGE: Record<FieldSource, { label: string; cls: string }> = {
  auto: { label: "Auto-Entwurf", cls: "amber" },
  confirmed: { label: "Bestätigt", cls: "green" },
  todo: { label: "Bitte setzen", cls: "rose" },
};

function Badge({ src }: { src?: FieldSource }) {
  if (!src) return null;
  const b = BADGE[src];
  return <span className={`fbadge ${b.cls}`}>{b.label}</span>;
}

export function ProfileForm({
  shopId,
  shopName,
  shopifyConfigured,
  initial,
}: {
  shopId: string;
  shopName: string;
  shopifyConfigured: boolean;
  initial: ProfileView;
}) {
  const [data, setData] = useState<ProfileData>(initial.data);
  const [sources, setSources] = useState<ProfileSources>(initial.sources);
  const [shopifySummary, setShopifySummary] = useState(initial.shopifySummary);
  const [scrapeSummary, setScrapeSummary] = useState(initial.scrapeSummary);
  const [url, setUrl] = useState(initial.websiteUrl || initial.data.website || "");
  const [error, setError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();
  const [shopBusy, setShopBusy] = useState(false);
  const [webBusy, setWebBusy] = useState(false);

  function set<K extends keyof ProfileData>(key: K, value: ProfileData[K]) {
    setData((d) => ({ ...d, [key]: value }));
  }

  function save() {
    setError(null);
    startSave(async () => {
      try {
        setSources(await saveProfile(shopId, data));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  async function pullShopify() {
    setError(null);
    setShopBusy(true);
    try {
      const r = await refreshShopifyProfile(shopId);
      setData(r.data);
      setSources(r.sources);
      setShopifySummary(r.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setShopBusy(false);
    }
  }

  async function analyzeWebsite() {
    setError(null);
    setWebBusy(true);
    try {
      setScrapeSummary(await refreshWebsiteProfile(shopId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWebBusy(false);
    }
  }

  // Render-Helfer (KEINE Komponenten — sonst Fokus-Verlust bei jedem Tastendruck).
  const label = (k: keyof ProfileData, text: string) => (
    <span className="plabel">{text} <Badge src={sources[k]} /></span>
  );
  const text = (k: keyof ProfileData, lbl: string, ph?: string) => (
    <label className="pfield">
      {label(k, lbl)}
      <input value={data[k] as string} placeholder={ph} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );
  const area = (k: keyof ProfileData, lbl: string, ph?: string) => (
    <label className="pfield">
      {label(k, lbl)}
      <textarea rows={3} value={data[k] as string} placeholder={ph} onChange={(e) => set(k, e.target.value as never)} />
    </label>
  );
  const select = (k: keyof ProfileData, lbl: string, opts: [string, string][]) => (
    <label className="pfield">
      {label(k, lbl)}
      <select value={data[k] as string} onChange={(e) => set(k, e.target.value as never)}>
        <option value="">— nicht gesetzt</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  const preview = buildSystemPrompt(data, shopName);

  return (
    <div className="profile">
      {error && <div className="formerror">{error}</div>}

      <section className="card">
        <h2>Automatische Befüllung</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Erst Daten holen, dann nur das Nötige ergänzen. Shopify ist das verlässliche Rückgrat;
          gescrapte Website-Inhalte sind ein Entwurf zum Prüfen.
        </p>
        <div className="srcrow">
          <button className="btnlink" disabled={shopBusy || !shopifyConfigured} onClick={pullShopify}>
            {shopBusy ? "Lädt…" : "Aus Shopify aktualisieren"}
          </button>
          {!shopifyConfigured && <span className="muted">Erst Shopify im Reiter „Zugang" verbinden.</span>}
          {shopifySummary && (
            <span className="muted">
              {shopifySummary.productTypes.length} Produkttypen · {shopifySummary.collections} Kollektionen ·
              Policies: {shopifySummary.policies.join(", ") || "—"}
            </span>
          )}
        </div>
        <div className="srcrow">
          <input
            style={{ flex: 1, minWidth: 220 }}
            placeholder="Shop-URL (z. B. repello.de)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btnlink" disabled={webBusy || !url.trim()} onClick={analyzeWebsite}>
            {webBusy ? "Analysiert…" : "Website neu analysieren"}
          </button>
        </div>
        {scrapeSummary && (
          <div className="muted" style={{ fontSize: 12 }}>
            Gescrapt ({scrapeSummary.pages.length} Seiten): {scrapeSummary.pages.map((p) => p.title).join(" · ") || "nichts gefunden"}
          </div>
        )}
      </section>

      <section className="card">
        <h2>1 · Basis &amp; Identität</h2>
        {area("whatSold", "Was verkauft der Shop?", "Sortiment, Produktkategorien…")}
        {area("brandCore", "Markenkern (1–2 Sätze)", "Wofür steht die Marke?")}
        {text("website", "Website", "https://…")}
        {text("supportHours", "Support-Zeiten", "z. B. Mo–Fr 9–17 Uhr")}
      </section>

      <section className="card">
        <h2>2 · Tonalität</h2>
        <div className="prow">
          {select("address", "Anrede", [["du", "Duzen (Du)"], ["sie", "Siezen (Sie)"]])}
          {select("style", "Stil", [["locker", "locker"], ["sachlich", "sachlich"], ["premium", "premium"]])}
        </div>
        <div className="prow">
          {select("length", "Antwortlänge", [["kurz", "kurz"], ["mittel", "mittel"], ["lang", "ausführlich"]])}
          {select("emojis", "Emojis", [["ja", "ja, sparsam"], ["nein", "nein"]])}
        </div>
        {text("greeting", "Begrüßung", "z. B. Hallo {Name},")}
        {area("signature", "Feste Signatur (wird automatisch unter jede Antwort gesetzt)", "z. B.\nViele Grüße\ndein Repello-Team\nsupport@repello.de")}
        <p className="muted" style={{ margin: "-4px 0 4px", fontSize: 12 }}>
          Diese Signatur hängt die KI immer exakt so an den Entwurf an — sie schreibt keine eigene Grußformel mehr. Leer lassen = die KI formuliert den Abschluss selbst.
        </p>
        <ListField
          label="Beispiel-Antworten"
          items={data.examples}
          onChange={(v) => set("examples", v)}
          placeholder="Eine vorbildliche Antwort einfügen…"
        />
      </section>

      <section className="card">
        <h2>3 · Richtlinien</h2>
        {area("returnPeriod", "Retourenfrist & -bedingungen")}
        {area("notReturnable", "Was ist NICHT retournierbar?", "z. B. gravierte/personalisierte Artikel")}
        {area("exchange", "Umtausch")}
        {area("refund", "Erstattung (Frist/Ablauf)")}
        {area("shipping", "Versand (Dauer DE/AT, Carrier, bei Verzug/Verlust)")}
        {area("damage", "Schäden/Reklamation", "z. B. Kunde soll Fotos schicken")}
        {text("discountAuthority", "Rabatt-Befugnis des Supports (bis welcher Wert?)", "z. B. bis 10 % / 20 €")}
      </section>

      <section className="card">
        <h2>4 · Produktwissen &amp; FAQ</h2>
        <FaqField items={data.faq} onChange={(v) => set("faq", v)} />
        {area("specialties", "Besonderheiten", "Materialien, Pflege, Kompatibilität…")}
      </section>

      <section className="card">
        <h2>5 · Grenzen / Don&apos;ts</h2>
        {area("donts", "Was darf nie behauptet/zugesagt werden?", "z. B. keine Heilversprechen")}
      </section>

      <section className="card">
        <h2>6 · Eskalationsregeln</h2>
        {area(
          "escalationRules",
          "Wann NICHT selbst antworten, sondern an einen Menschen abgeben?",
          "z. B. rechtliche Drohung, Presse, sehr verärgert, Betrag über 200 €",
        )}
      </section>

      <section className="card">
        <h2>Prompt-Vorschau</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          So wird der System-Prompt aus dem Profil gebaut (aktualisiert live; gespeichert beim Speichern).
        </p>
        <pre className="promptview">{preview}</pre>
      </section>

      <div className="formactions">
        <button className="primary" disabled={savePending} onClick={save}>
          {savePending ? "Speichert…" : "Profil speichern"}
        </button>
      </div>
    </div>
  );
}

function ListField({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="pfield">
      <span className="plabel">{label}</span>
      {items.map((it, i) => (
        <div key={i} className="listrow">
          <textarea
            rows={3}
            value={it}
            placeholder={placeholder}
            onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))}
          />
          <button type="button" className="warn ghost" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            entfernen
          </button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => onChange([...items, ""])}>
        + hinzufügen
      </button>
    </div>
  );
}

function FaqField({ items, onChange }: { items: FaqItem[]; onChange: (v: FaqItem[]) => void }) {
  const upd = (i: number, patch: Partial<FaqItem>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  return (
    <div className="pfield">
      <span className="plabel">Häufige Fragen + Wunsch-Antworten</span>
      {items.map((f, i) => (
        <div key={i} className="faqrow">
          <input placeholder="Frage" value={f.q} onChange={(e) => upd(i, { q: e.target.value })} />
          <textarea rows={2} placeholder="Wunsch-Antwort" value={f.a} onChange={(e) => upd(i, { a: e.target.value })} />
          <button type="button" className="warn ghost" onClick={() => onChange(items.filter((_, idx) => idx !== i))}>
            entfernen
          </button>
        </div>
      ))}
      <button type="button" className="ghost" onClick={() => onChange([...items, { q: "", a: "" }])}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
