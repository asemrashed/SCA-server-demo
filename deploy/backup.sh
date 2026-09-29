#!/usr/bin/env bash
# Daily / on-demand backup of Postgres + uploads for SCA LMS (VPS).
# Usage:
#   bash deploy/backup.sh
# Env (optional):
#   BACKUP_ROOT   — default /var/backups/sca-lms
#   UPLOAD_DIR    — default /var/www/sca-lms/uploads (fallback: ./uploads)
#   RETENTION_DAYS — default 14
#   DATABASE_URL or DIRECT_URL — from .env / environment
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(DATABASE_URL|DIRECT_URL|UPLOAD_DIR)=' .env | sed 's/\r$//' || true)
  set +a
fi
if [[ -f .env.production ]] && [[ "${NODE_ENV:-}" == "production" || -n "${USE_PRODUCTION_ENV:-}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(DATABASE_URL|DIRECT_URL|UPLOAD_DIR)=' .env.production | sed 's/\r$//' || true)
  set +a
fi

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/sca-lms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_URL="${DIRECT_URL:-${DATABASE_URL:-}}"
UPLOAD_SRC="${UPLOAD_DIR:-}"
if [[ -z "$UPLOAD_SRC" ]]; then
  if [[ -d /var/www/sca-lms/uploads ]]; then
    UPLOAD_SRC=/var/www/sca-lms/uploads
  else
    UPLOAD_SRC="$ROOT/uploads"
  fi
fi

if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL or DIRECT_URL is not set." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

echo "==> Backup directory: $DEST"

echo "==> pg_dump"
if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --no-owner --format=custom --file="$DEST/db.dump" "$DB_URL"
else
  echo "WARN: pg_dump not found; writing SQL via docker/postgres client if available..."
  if command -v docker >/dev/null 2>&1; then
    docker run --rm postgres:16 pg_dump --no-owner --format=custom "$DB_URL" >"$DEST/db.dump"
  else
    echo "ERROR: Install postgresql-client (pg_dump) on the VPS." >&2
    exit 1
  fi
fi

echo "==> uploads archive ($UPLOAD_SRC)"
if [[ -d "$UPLOAD_SRC" ]]; then
  tar -C "$(dirname "$UPLOAD_SRC")" -czf "$DEST/uploads.tar.gz" "$(basename "$UPLOAD_SRC")"
else
  echo "WARN: uploads directory not found ($UPLOAD_SRC); skipping files."
  touch "$DEST/uploads.tar.gz.empty"
fi

echo "$STAMP" >"$DEST/MANIFEST.txt"
{
  echo "createdAtUtc=$STAMP"
  echo "dbUrlHost=$(echo "$DB_URL" | sed -E 's|.*@([^/]+)/.*|\1|')"
  echo "uploadSrc=$UPLOAD_SRC"
} >>"$DEST/MANIFEST.txt"

ln -sfn "$DEST" "$BACKUP_ROOT/latest"

echo "==> pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf {} + 2>/dev/null || true

echo "Backup complete: $DEST"
echo "  db:      $DEST/db.dump"
echo "  uploads: $DEST/uploads.tar.gz"
echo "  latest:  $BACKUP_ROOT/latest"
