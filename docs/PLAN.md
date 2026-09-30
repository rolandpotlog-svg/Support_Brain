# Support Brain — Ausbauplan (Stand 30.09.2026)

Ziel: reines Support-Tool. Mehrere Shops strikt getrennt, Mitarbeiter je Shop. Lovenja (30–40 Mails/Tag)
wird sofort von der KI eingeordnet und beantwortet. Die KI lernt aus jeder Änderung. Die Produktanalyse
zeigt, welche Produkte immer wieder dieselben Probleme machen, als Liste für den Supplier.

## Phase 1: Sicherheit & Stabilität ✅ (dieser Stand)
- Bestelldaten nur verwenden, wenn die E-Mail zum Absender passt (sonst MENSCH, keine Details)
- Kein Doppel-Versand (atomare Sende-Sperre `outbox.claimed_at`)
- Worker-Zyklen überlappen nicht
- Leere KI-Entwürfe werden nicht gespeichert; mehr Token-Budget
- Antwort in der Sprache des Kunden (Standard Deutsch)
- Zitierter Altverlauf raus aus dem Prompt
- Abwesenheitsnotizen/Zustellfehler bekommen keinen Entwurf

## Phase 2: Produkt-Problem-Analyse (Kern)
- Einordnung v2 je Ticket: Thema, **Problemart** (z. B. „Verschluss defekt“, „Box beschädigt“, „Gravur falsch“),
  **Lob/positives Feedback**, Produkt **aus der echten Shopify-Produktliste** (keine Freitexte), Kurz-Zitat
- Problemarten je Shop lernen/zusammenfassen (gleiche Probleme = gleicher Name)
- Neue Einordnung bei neuer Kundenmail im selben Ticket
- Retouren + Reklamationen auf dieselbe Produktliste
- Seite „Produkte“: je Produkt Tickets, Problemarten, Retouren-Gründe, Defekte, Lob, Trend, Ampel;
  Klick → Beispiel-Tickets mit Zitaten/Fotos
- **Supplier-Liste** (Excel/PDF): Produkt × Problemart × Anzahl × Zeitraum × Beispiele
- Optional: verkaufte Stück (nur Menge) für Quoten

## Phase 3: Lernendes Gehirn
- Lernbuch je Shop: aus jeder Änderung am Entwurf und jedem Schattenbetrieb-Vergleich eine Regel
  vorschlagen → Freigabe durch Roland → fließt in jeden Entwurf ein
- Beste eigene Antworten als Beispiele (ähnliche gelöste Tickets, pgvector)
- Mehr Kontext: Variante + Gravur-Text, alle Bestellungen, Kundenhistorie, Kundenfotos
- Messung: Ähnlichkeit statt nur „geändert/unverändert“, nur AUTO-Entwürfe zählen zur Reife
- Auto-Senden je Shop + Thema, erst nach Reife (30× unverändert), mit Fakten-Prüfung + Verzögerung

## Phase 4: Übersicht & Benutzer
- Shop ohne Shopify anlegbar; Onboarding-Checkliste je Shop; klare Tabs
- „Neuer Mitarbeiter“ in einem Schritt (Shop + Rolle, Rollen erklärt, Passwort generieren,
  eigenes Passwort ändern)
- Admin-Rechte konsistent (Founder/Admin)
- Navigation entrümpeln: Social/Fälle nur wenn eingerichtet, Notizen+Roadmap ins Admin,
  Schnellantworten in die Leiste
- Posteingang: Ordner „Wartet auf Kunde“, Entwurf-/KI-Hinweis in der Liste, Tastenkürzel
- Reports verschlanken
