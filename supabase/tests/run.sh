#!/usr/bin/env bash
# Runs the migration and RLS tests against a throwaway Postgres 16 database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=cardfile_test_$$
createdb "$DB"
trap 'dropdb "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f stubs.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0001_cardfile.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f rls_test.sql
