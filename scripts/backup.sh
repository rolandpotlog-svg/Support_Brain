#!/usr/bin/env bash
# Tägliches Datenbank-Backup via pg_dump. Lokal jetzt, portabel auf den VPS.
# Aufbewahrung: die letzten BACKUP_KEEP Dumps (Standard 14). Komprimiert (custom format).
set -euo pipefail

# .env laden (DATABASE_URL), falls vorhanden.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$ROOT_DIR/.env" ]; then
  set -a; . "$ROOT_DIR/.env"; set +a
fi

: "${DATABASE_URL:?DATABASE_URL nicht gesetzt}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

# pg_dump aus Homebrew-Postgres (lokal). Auf dem VPS liegt es regulär im PATH.
PG_DUMP="$(command -v pg_dump || echo /opt/homebrew/opt/postgresql@17/bin/pg_dump)"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/support_brain-$STAMP.dump"

"$PG_DUMP" --format=custom --no-owner --dbname="$DATABASE_URL" --file="$OUT"
echo "Backup geschrieben: $OUT"

# Rotation: alles außer den neuesten BACKUP_KEEP löschen.
ls -1t "$BACKUP_DIR"/support_brain-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo "Alt gelöscht: $old"
done

# Wiederherstellen (Beispiel):
#   pg_restore --clean --no-owner --dbname="$DATABASE_URL" <datei.dump>
