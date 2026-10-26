#!/bin/bash
# Roda a migração + testes em um Postgres temporário. Requer binários do PostgreSQL (initdb, pg_ctl, psql).
# Uso: bash supabase/tests/run.sh   (como usuário comum; se for root, usa o usuário "postgres")
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)"; export PATH="$BIN:$PATH"
DIR="$(mktemp -d /var/tmp/confere-pg.XXXXXX)"; PORT=54329
RUN=""; if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; chmod 755 "$HERE" "$HERE"/*; RUN="su postgres -c"; fi
as() { if [ -n "$RUN" ]; then $RUN "$*"; else bash -c "$*"; fi; }
cleanup() { as "$BIN/pg_ctl -D $DIR/data stop -m immediate >/dev/null 2>&1" || true; rm -rf "$DIR"; }
trap cleanup EXIT
as "$BIN/initdb -D $DIR/data -A trust >/dev/null"
as "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start >/dev/null"
P="$BIN/psql -h $DIR -p $PORT -d postgres -q -v ON_ERROR_STOP=1"
as "$P -f $HERE/tests/stubs.sql" && as "$P -f $HERE/migrations/0001_base.sql" && as "$P -f $HERE/tests/rls.test.sql"
