"use client";
import { useState } from "react";
import Link from "next/link";

type Cat = { category: string; n: number; prev: number };
type Ticket = { id: string; number: number; subject: string | null; sentiment: string | null };

const sentIcon = (s: string | null) => (s === "negativ" ? "🔴" : s === "positiv" ? "🟢" : "⚪");

/** Kategorien als aufklappbare Liste — Klick zeigt die Tickets dahinter (z. B. was in „Sonstiges" steckt). */
export function CategoryBreakdown({
  categories,
  tickets,
  maxCat,
}: {
  categories: Cat[];
  tickets: Record<string, Ticket[]>;
  maxCat: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 14 }}>
      {categories.map((c) => {
        const isOpen = open === c.category;
        const list = tickets[c.category] ?? [];
        return (
          <div key={c.category} style={{ borderBottom: "1px solid var(--border)" }}>
            <button
              onClick={() => setOpen(isOpen ? null : c.category)}
              title="Klicken: Tickets dieser Kategorie anzeigen"
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "230px 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "9px 0",
                background: "none",
                border: "none",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
              }}
            >
              <span style={{ fontWeight: 500 }}>
                <span className="muted" style={{ marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                {c.category}
              </span>
              <span className="catbar" style={{ width: `${Math.round((c.n / maxCat) * 100)}%` }} />
              <span>
                <strong>{c.n}</strong>{" "}
                {c.prev > 0 && <span className="muted" style={{ fontSize: 12 }}>({c.prev} zuvor)</span>}
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: "2px 0 12px 20px", display: "flex", flexDirection: "column", gap: 5 }}>
                {list.length === 0 ? (
                  <span className="muted" style={{ fontSize: 13 }}>Keine Beispiel-Tickets vorhanden.</span>
                ) : (
                  list.map((t) => (
                    <Link
                      key={t.id}
                      href={`/inbox?ticket=${t.id}`}
                      style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline", color: "inherit", textDecoration: "none" }}
                    >
                      <span>{sentIcon(t.sentiment)}</span>
                      <span className="muted">#{t.number}</span>
                      <span style={{ textDecoration: "underline" }}>{t.subject || "(kein Betreff)"}</span>
                    </Link>
                  ))
                )}
                {list.length >= 40 && (
                  <span className="muted" style={{ fontSize: 12 }}>… nur die ersten 40 gezeigt.</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
