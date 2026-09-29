#!/usr/bin/env bash
# Safe VPS deploy for sca-server. Run from repo root on the VPS:
#   bash deploy/deploy.sh
#
# Uses `prisma migrate deploy` only — never `db push --accept-data-loss`.
# Takes a pre-deploy backup of DB + uploads (set SKIP_BACKUP=1 to skip).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PM2_APP="${PM2_APP:-sca-backend5000}"

if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  echo "==> pre-deploy backup"
  USE_PRODUCTION_ENV=1 bash "$ROOT/deploy/backup.sh" || {
    echo "WARN: backup failed — continuing deploy. Fix backup ASAP." >&2
  }
fi

echo "==> git pull"
git pull

echo "==> prisma migrate deploy"
npx prisma migrate deploy

if command -v bun >/dev/null 2>&1; then
  echo "==> bun install"
  bun install
  echo "==> bun run build"
  bun run build
else
  echo "==> npm ci"
  npm ci
  echo "==> npm run build"
  npm run build
fi

echo "==> pm2 restart ${PM2_APP} --update-env"
pm2 restart "$PM2_APP" --update-env

echo "Deploy complete."
echo "Tip: install daily backups once with: bash deploy/install-backup-cron.sh"
