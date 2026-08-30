#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p backups
user="${POSTGRES_ADMIN_USER:-craftifai_owner}"
db="${POSTGRES_DB:-craftifai}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/craftifai-${stamp}.sql"
docker compose exec -T postgres pg_dump -U "$user" -d "$db" --no-owner >"$out"
echo "$out"
