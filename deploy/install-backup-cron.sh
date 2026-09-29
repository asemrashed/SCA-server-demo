#!/usr/bin/env bash
# Install daily cron for deploy/backup.sh (idempotent).
# Run once on the VPS as root or the app user:
#   bash deploy/install-backup-cron.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SCRIPT="$ROOT/deploy/backup.sh"
CRON_MARK="sca-lms-backup"
LOG="${BACKUP_ROOT:-/var/backups/sca-lms}/backup.log"

mkdir -p "$(dirname "$LOG")"
chmod +x "$BACKUP_SCRIPT" "$ROOT/deploy/restore.sh" 2>/dev/null || true

# 02:15 UTC daily
CRON_LINE="15 2 * * * cd \"$ROOT\" && USE_PRODUCTION_ENV=1 bash \"$BACKUP_SCRIPT\" >> \"$LOG\" 2>&1 # $CRON_MARK"

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(echo "$EXISTING" | grep -v "$CRON_MARK" || true)"
{
  echo "$FILTERED"
  echo "$CRON_LINE"
} | grep -v '^$' | crontab -

echo "Installed cron:"
echo "  $CRON_LINE"
echo "List with: crontab -l"
echo "Manual backup: bash $BACKUP_SCRIPT"
echo "Restore:       bash $ROOT/deploy/restore.sh"
