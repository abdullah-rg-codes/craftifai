#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
dump="${1:?usage: restore.sh backups/craftifai-....sql}"
user="${POSTGRES_ADMIN_USER:-craftifai_owner}"
db="${POSTGRES_DB:-craftifai}"

docker compose stop api-1 api-2 proxy bootstrap || true
docker compose exec -T postgres psql -U "$user" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid();"
docker compose exec -T postgres psql -U "$user" -d postgres -c "DROP DATABASE IF EXISTS ${db};"
docker compose exec -T postgres psql -U "$user" -d postgres -c "CREATE DATABASE ${db} OWNER ${user};"
docker compose exec -T postgres psql -U "$user" -d "$db" <"$dump"
docker compose up -d --wait api-1 api-2 proxy
