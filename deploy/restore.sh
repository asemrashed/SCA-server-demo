#!/usr/bin/env bash
# Restore Postgres + uploads from a backup created by deploy/backup.sh
# Usage:
#   bash deploy/restore.sh                  # uses BACKUP_ROOT/latest
#   bash deploy/restore.sh /var/backups/sca-lms/20260708T120000Z
#
# DANGER: overwrites the live database and uploads. Stop the API first.
#   pm2 stop sca-serve4001
#   bash deploy/restore.sh
#   pm2 start sca-serve4001
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(DATABASE_URL|DIRECT_URL|UPLOAD_DIR)=' .env | sed 's/\r$//' || true)
  set +a
fi

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/sca-lms}"
SRC="${1:-$BACKUP_ROOT/latest}"
DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
UPLOAD_DST="${UPLOAD_DIR:-}"
if [[ -z "$UPLOAD_DST" ]]; then
  if [[ -d /var/www/sca-lms/uploads ]] || [[ -d /var/www/sca-lms ]]; then
    UPLOAD_DST=/var/www/sca-lms/uploads
  else
    UPLOAD_DST="$ROOT/uploads"
  fi
fi

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL or DIRECT_URL is not set." >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: backup directory not found: $SRC" >&2
  exit 1
fi

DB_FILE="$SRC/db.dump"
UPLOAD_FILE="$SRC/uploads.tar.gz"

if [[ ! -f "$DB_FILE" ]]; then
  echo "ERROR: missing $DB_FILE" >&2
  exit 1
fi

echo "WARNING: This will OVERWRITE the database at:"
echo "  $(echo "$DB_URL" | sed -E 's|://[^@]+@|://***@|')"
echo "And restore uploads into: $UPLOAD_DST"
echo "From backup: $SRC"
read -r -p "Type RESTORE to continue: " CONFIRM
if [[ "$CONFIRM" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

echo "==> pg_restore (clean)"
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore --clean --if-exists --no-owner --dbname="$DB_URL" "$DB_FILE"
else
  echo "ERROR: Install postgresql-client (pg_restore)." >&2
  exit 1
fi

if [[ -f "$UPLOAD_FILE" ]]; then
  echo "==> restore uploads"
  mkdir -p "$(dirname "$UPLOAD_DST")"
  TMP="$(mktemp -d)"
  tar -xzf "$UPLOAD_FILE" -C "$TMP"
  # archive contains single top-level folder
  INNER="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
  if [[ -n "$INNER" ]]; then
    rm -rf "$UPLOAD_DST"
    mkdir -p "$UPLOAD_DST"
    cp -a "$INNER"/. "$UPLOAD_DST"/
  fi
  rm -rf "$TMP"
else
  echo "WARN: no uploads.tar.gz in backup; skipping files."
fi

echo "Restore complete from $SRC"
echo "Restart the API (pm2 restart) and smoke-test."
