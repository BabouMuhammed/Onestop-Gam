#!/usr/bin/env bash
# Daily PostgreSQL backup. See docs/BACKUP.md for scheduling and the restore steps.
#
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/onestop tools/backup.sh
#
# Writes one compressed dump per run and deletes dumps older than BACKUP_KEEP_DAYS.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/onestop-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Custom format: compressed, and restorable table by table with pg_restore.
pg_dump --format=custom --no-owner --no-privileges --file "$file.partial" "$DATABASE_URL"
mv "$file.partial" "$file"

# A dump that cannot be listed is not a backup.
pg_restore --list "$file" > /dev/null

find "$BACKUP_DIR" -name 'onestop-*.dump' -type f -mtime +"$BACKUP_KEEP_DAYS" -delete
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
