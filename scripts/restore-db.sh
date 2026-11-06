#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: ./scripts/restore-db.sh backups/backup-file.sql" >&2
  exit 1
fi
echo "WARNING: this replaces the current PostgreSQL database contents."
read -r -p "Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || exit 1
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"' < "$1"
echo "Database restore completed."
