#!/usr/bin/env bash
# Nightly backup of the database and uploaded files. Keeps 30 days.
# Install:  sudo cp deploy/backup.sh /etc/cron.daily/smarthr-backup && sudo chmod +x /etc/cron.daily/smarthr-backup
# Copy /var/backups/smarthr to another machine or bucket as well — a backup on the same server is not enough.
set -euo pipefail

DB_NAME="${DB_NAME:-smarthr}"
DB_USER="${DB_USER:-smarthr}"
UPLOADS="${UPLOADS:-/var/www/smarthr/backend/storage}"
DEST="${DEST:-/var/backups/smarthr}"
STAMP="$(date +%F-%H%M)"

mkdir -p "$DEST"
pg_dump -U "$DB_USER" -h 127.0.0.1 -Fc "$DB_NAME" > "$DEST/db-$STAMP.dump"
tar -czf "$DEST/files-$STAMP.tar.gz" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"

find "$DEST" -name 'db-*.dump' -mtime +30 -delete
find "$DEST" -name 'files-*.tar.gz' -mtime +30 -delete
echo "backup ok: $DEST/db-$STAMP.dump"

# Restore test (do this once a month into a scratch database):
#   createdb -U smarthr smarthr_restore_test
#   pg_restore -U smarthr -d smarthr_restore_test /var/backups/smarthr/db-<stamp>.dump
