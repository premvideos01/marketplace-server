#!/bin/bash
# Daily log rotation for marketplace-server.
# Truncates /tmp/marketplace-server.{log,err} when they exceed 10 MB,
# keeping the last rotated copy compressed for diagnosis.

set -euo pipefail

ROTATE_AT_BYTES=$((10 * 1024 * 1024))
LOG_DIR="/tmp"

for base in marketplace-server.log marketplace-server.err marketplace-backup.log marketplace-backup.err; do
  f="${LOG_DIR}/${base}"
  [ -f "$f" ] || continue
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f")
  if [ "$size" -gt "$ROTATE_AT_BYTES" ]; then
    /usr/bin/gzip -c "$f" > "${f}.1.gz"
    : > "$f"
    echo "[$(date)] rotated ${base} (was $((size / 1024 / 1024)) MB)"
  fi
done
