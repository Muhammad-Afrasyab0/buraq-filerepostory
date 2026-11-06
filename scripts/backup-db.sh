#!/usr/bin/env bash
set -euo pipefail
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="backups/buraq-postgres-${STAMP}.sql"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$FILE"
echo "Database backup created: $FILE"
