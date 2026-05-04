#!/bin/bash
# Nightly SQLite backup — uses sqlite3 .backup which is safe with WAL & live writers.
# Keeps last 14 backups; uploads dir is NOT backed up here (rsync that separately if you care).

set -euo pipefail

DB="/Users/computer/.openclaw/workspace/marketplace-data/marketplace.db"
DEST_DIR="/Users/computer/.openclaw/workspace/marketplace-backups"
KEEP=14
TS=$(date +%Y%m%d-%H%M%S)
OUT="${DEST_DIR}/marketplace-${TS}.db"

mkdir -p "$DEST_DIR"

if [ ! -f "$DB" ]; then
  echo "[$(date)] backup-db.sh: DB not found at $DB — skipping" >&2
  exit 0
fi

# .backup is the recommended online-backup mechanism; safe with concurrent writes.
/usr/bin/sqlite3 "$DB" ".backup '$OUT'"

# Compress to save space (sqlite files compress well — 5-10x).
/usr/bin/gzip -f "$OUT"

# Prune older backups, keep latest $KEEP.
ls -1t "${DEST_DIR}"/marketplace-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

# Quick log line so we can see runs in stdout.
echo "[$(date)] backup-db.sh: wrote ${OUT}.gz ($(du -h "${OUT}.gz" | awk '{print $1}'))"
