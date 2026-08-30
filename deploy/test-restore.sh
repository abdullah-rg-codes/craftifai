#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
user="${POSTGRES_ADMIN_USER:-craftifai_owner}"
db="${POSTGRES_DB:-craftifai}"

dump="$(bash deploy/backup.sh)"
docker compose exec -T postgres psql -U "$user" -d "$db" \
  -c "UPDATE org_credit_accounts SET available = available + 1 WHERE true;"
bash deploy/restore.sh "$dump"
mismatch="$(docker compose exec -T postgres psql -U "$user" -d "$db" -Atc "
  SELECT count(*) FROM org_credit_accounts a
   WHERE a.available IS DISTINCT FROM (
           SELECT coalesce(sum(delta_available),0) FROM credit_ledger l WHERE l.org_id = a.org_id
         )
      OR a.reserved IS DISTINCT FROM (
           SELECT coalesce(sum(delta_reserved),0) FROM credit_ledger l WHERE l.org_id = a.org_id
         );")"
if [ "$mismatch" != "0" ]; then
  echo "restore invariant failed: $mismatch mismatched accounts" >&2
  exit 1
fi
echo "restore ok: available/reserved match ledger sums"
