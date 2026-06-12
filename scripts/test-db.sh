#!/usr/bin/env bash
# Validate the SundayBasar migration + game logic against a throwaway Postgres.
# Requires Docker. Spins up postgres:16, recreates the Supabase-provided roles /
# realtime publication the migration expects, applies the migration (twice, to
# prove idempotency), runs the game-logic assertions, then tears everything down.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=sb-pgtest
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

run() { docker cp "$1" "$NAME:/tmp/$(basename "$1")" >/dev/null; docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$(basename "$1")"; }

echo "→ prelude (Supabase role/publication shims)"; run supabase/tests/_prelude.sql
echo "→ migration (1st apply)"; run supabase/migrations/0001_basar_schema.sql
echo "→ migration (2nd apply — idempotency)"; run supabase/migrations/0001_basar_schema.sql
echo "→ game-logic assertions"
docker cp supabase/tests/basar_logic_test.sql "$NAME:/tmp/basar_logic_test.sql" >/dev/null
OUT=$(docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/basar_logic_test.sql 2>&1)
echo "$OUT" | grep -E "PASS|FAIL" || true
echo "$OUT" | grep -q "ALL GAME-LOGIC TESTS PASSED" || { echo "TESTS FAILED"; exit 1; }
echo "✓ all database checks passed"
