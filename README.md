# Support-Brain

Internes, KI-gestütztes Support-Cockpit für unsere eigenen Shops. Mehrere Mitarbeiter
und die Geschäftsführung arbeiten Support-Mails über ein gemeinsames Dashboard ab —
Multi-Shop, ein Gehirn.

**Grundprinzip:** null Fixkosten — alles **kostenlos, Open Source, selbst gehostet**.
Läuft vorerst lokal; portabel auf einen gemieteten VPS, ohne Umbau.

> **Phase 1** (Fundament): Logins/Rollen · geteilter Posteingang · IMAP rein / SMTP raus ·
> Eskalation an die Geschäftsführung · Kill-Switch pro Shop · tägliches DB-Backup.
> KI-Entwürfe, Makros und Module folgen ab Phase 2.

## Stack (alles selbst gehostet / OSS)

| Schicht | Technik |
|---|---|
| App (UI + API in einem) | **Next.js** (App Router, TypeScript) |
| Datenbank | **PostgreSQL 17 + pgvector** (Homebrew lokal, später VPS) |
| ORM / Migrationen | **Drizzle** |
| Auth | **Auth.js / NextAuth** (Credentials, Nutzer in unserer Postgres; Rollen `agent`/`admin`) |
| Mail-Worker | **TypeScript** (imapflow + nodemailer + node-cron) |
| Backup | **pg_dump**, täglich (launchd lokal / cron auf VPS) |

## Einrichtung (lokal, macOS)

Voraussetzungen sind bereits installiert: Node und PostgreSQL 17 + pgvector (Homebrew),
DB `support_brain` mit aktivierter `vector`-Extension.

```bash
cd ~/Documents/support-brain
npm install
cp .env.example .env        # DATABASE_URL prüfen; AUTH_SECRET + MAILBOX_ENC_KEY setzen
npm run db:generate         # Migration aus dem Schema erzeugen
npm run db:migrate          # Tabellen anlegen
npm run seed:admin -- deine@mail.tld "deinPasswort" "Dein Name"   # Erst-Admin
npm run dev                 # http://localhost:3000
```

Mail-Worker in einem zweiten Terminal:
```bash
npm run worker              # Dauerschleife (IMAP holen + SMTP senden)
# oder einmalig zum Testen:
npm run worker:once
```

## Tägliches Backup einrichten (macOS, launchd)

```bash
cp deploy/com.support-brain.backup.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.support-brain.backup.plist
# Sofort testen:
npm run backup              # schreibt nach ./backups/
```
Auf einem Linux-VPS stattdessen Cron: `0 3 * * * /pfad/scripts/backup.sh`.
Wiederherstellen: `pg_restore --clean --no-owner --dbname="$DATABASE_URL" backups/<datei>.dump`.

## Erste Schritte im Tool
1. Als Admin einloggen → **Admin** → **Shop anlegen** (inkl. IMAP/SMTP-Zugang).
2. **Admin → Neuen Login anlegen**: E-Mail + Rolle + Shops.
3. Worker holt eingehende Mails → erscheinen im **Posteingang**.
4. Thread öffnen → Antwort schreiben → **freigeben & senden** (Draft-First) oder **eskalieren**.
5. Pro Shop **Kill-Switch** (KI später aus/an); der Mailabruf läuft immer.

## Shopify-Anbindung (rechtes Panel)

Das rechte Panel zieht Kunde + Bestellungen live über die **Shopify Admin GraphQL API**.
Token als Secret in `.env` (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`) — nie im Code.

**Architektur-Linie:** Die Shopify-Integration läuft **durchgängig über die Admin-API** — für
Daten *und* für spätere KI-Aktionen (Refund/Retoure). Die Shopify-**MCP-Verbindung ist nur ein
optionales Dev-/Explorations-Werkzeug**, nicht Teil des Produktionspfads. KI-Aktionen folgen dem
Muster **Claude schlägt strukturiert vor → Backend validiert (Limits/Rolle) → Mensch gibt frei →
unser Code führt über die Admin-API aus** (mit Audit-Log). Das Modell fasst nie direkt Geld an.
Für Phase 3 zusätzlich nötig: Write-Scopes (`write_orders` o. ä.).

**Token erstellen** (einmalig, im Shopify-Admin):
1. *Einstellungen → Apps und Vertriebskanäle → Apps entwickeln → App erstellen*.
2. *Admin API integration* → Scopes: `read_orders`, `read_customers`, `read_fulfillments`, `read_products`.
3. *Installieren* → **Admin API access token** (`shpat_…`) kopieren → in `.env` bei `SHOPIFY_ADMIN_TOKEN`.
4. `SHOPIFY_STORE_DOMAIN` = `deinshop.myshopify.com`. Dev neu starten.

**Automatischer Abgleich pro Ticket** (in dieser Reihenfolge):
1. **Bestellnummer** in Betreff/Text (z. B. `#335675775`) → exakt diese Bestellung.
2. Sonst **Absender-E-Mail** → Shopify-Kunde + dessen Bestellungen (durchblätterbar).
3. Sonst **Name** (Fallback) → mehrdeutig: Kandidatenliste zur manuellen Auswahl,
   nie stillschweigende Zuordnung. Kein Treffer → „Keine Bestellung gefunden" + manuelle Suche.

Ohne gesetzten Token zeigt das Panel einen Hinweis; die App läuft normal weiter.

## Umzug auf einen VPS (später)
Nur nötig: PostgreSQL auf dem Server, `DATABASE_URL` umstellen, App + Worker dort starten
(`npm run build && npm start`, Worker als Dienst), Cron-Backup. Kein Code-Umbau.

## Sicherheit
- `AUTH_SECRET` und `MAILBOX_ENC_KEY` sind geheim — nur in `.env`, nicht commiten.
- Postfach-Passwörter liegen AES-256-GCM-verschlüsselt; verliert man `MAILBOX_ENC_KEY`, müssen sie neu hinterlegt werden.
- Das alte Supabase/FastAPI-Gerüst liegt unter `_archiv/` (nicht mehr verwendet).
