# Deployment auf Render (Web + Worker + Postgres)

Frischer Start (leere DB). Die lokale DB bleibt unangetastet.

## 0) Secrets generieren (lokal, einmal)
```bash
openssl rand -base64 32   # -> MAILBOX_ENC_KEY
openssl rand -base64 32   # -> AUTH_SECRET
```
Beide Werte notieren. **MAILBOX_ENC_KEY nie mehr ändern** (sonst sind alle gespeicherten Postfach-/Shopify-Tokens unlesbar).

## 1) Repo auf GitHub (privat)
```bash
git add -A && git commit -m "Render-Deployment vorbereitet"
# privates Repo auf github.com anlegen, dann:
git remote add origin git@github.com:<DEIN-USER>/support-brain.git
git push -u origin main
```
`.env` ist gitignoriert und geht NICHT mit — richtig so.

## 2) Render Blueprint
Render Dashboard → **New → Blueprint** → dein Repo wählen → Render liest `render.yaml`
und legt an: **support-brain-web**, **support-brain-worker**, **support-brain-db**.

## 3) Secrets im Dashboard setzen
Unter **Env Groups → support-brain-shared** eintragen:
- `MAILBOX_ENC_KEY` = (aus Schritt 0)
- `AUTH_SECRET` = (aus Schritt 0)
- `ANTHROPIC_API_KEY` = dein Claude-Key

Beim **Web-Service** zusätzlich:
- `APP_URL` = die Render-URL (z. B. `https://support-brain-web.onrender.com`) — nach dem 1. Deploy setzen/aktualisieren
- `META_VERIFY_TOKEN` = frei wählbar, erst fürs Meta-Setup nötig

Dann **Deploy** starten. `preDeployCommand` (`db:migrate`) baut das Schema auf der leeren DB auf.

## 4) Ersten Admin anlegen
Web-Service → **Shell** öffnen:
```bash
npm run seed:admin -- deine@email.de DEIN-PASSWORT "Roland"
```
→ Login auf der Render-URL.

## 5) Brands einrichten (Admin → Brands)
Für **Repello** und **Lovenja** je:
- **Shopify-Zugang**: Store-Domain + Admin-API-Token
- **Postfach**: IMAP/SMTP (Host/Port/User/Passwort)
- **Profil/KI-Wissen** befüllen + **feste Signatur**
- Retouren-Einstellungen (optional)
- Schnellantworten: sag mir Bescheid, ich re-seede sie per SQL

## 6) Kollegen anlegen
Admin → Nutzer → Rolle **Mitarbeiter** je Brand (kein Finance).

## 7) Eigene Domain (optional)
Web-Service → Settings → Custom Domain → CNAME setzen. Danach `APP_URL` auf die Domain anpassen.

## 8) Meta anschließen (NACH dem Deploy — braucht die öffentliche URL)
1. Meta-App + App-Review (pages_messaging, pages_read_engagement, pages_manage_engagement, pages_manage_metadata) — **jetzt schon starten, langer Vorlauf**
2. Webhook-URL: `https://<deine-domain>/api/meta/webhook`, Verify-Token = `META_VERIFY_TOKEN`
3. Page-Abo auf `messages` + `feed`
4. In Admin → Brand → Social: Page-Access-Token + App-Secret eintragen → live

## Backup
Render-Postgres macht automatische Backups (bezahlter Plan). Zusätzlich portabel:
`scripts/backup.sh` per Render **Cron Job** (`0 3 * * *`).

## Health-Check nach Deploy
- Web erreichbar + Login ok
- Worker-Logs: „Mail(s) abgeholt / gesendet / getaggt"
- Test-Mail an ein Brand-Postfach → erscheint als Ticket
- Test-Antwort aus dem Tool → kommt beim Kunden an
