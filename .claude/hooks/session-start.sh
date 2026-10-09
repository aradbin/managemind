#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (see docs/adr/0008-local-postgres.md).
# Installs and starts Postgres 18, creates the local databases, installs dependencies.
# Idempotent: safe on startup, resume, clear and compact.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PG_MAJOR=18
PG_PORT=5432
PG_PASSWORD=postgres # local-only throwaway credential, never used outside this container
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

log() { echo "[session-start] $*" >&2; }

# 1. Postgres 18 from the PostgreSQL apt repository (the image ships only 16).
if [ ! -x "/usr/lib/postgresql/${PG_MAJOR}/bin/postgres" ]; then
  log "installing postgresql-${PG_MAJOR}"
  keyring=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  install -d "$(dirname "$keyring")"
  curl -fsSL -o "$keyring" https://www.postgresql.org/media/keys/ACCC4CF8.asc
  . /etc/os-release
  echo "deb [signed-by=${keyring}] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/pgdg.list \
    -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "postgresql-${PG_MAJOR}"
fi

# 2. Move any older preinstalled cluster off our port and stop it from auto-starting.
for conf in /etc/postgresql/*/*/postgresql.conf; do
  [ -e "$conf" ] || continue
  dir=$(dirname "$conf")
  ver=$(basename "$(dirname "$dir")")
  [ "$ver" = "$PG_MAJOR" ] && continue
  if grep -Eq "^port = ${PG_PORT}\b" "$conf"; then
    log "moving Postgres ${ver} cluster to port 5499"
    pg_ctlcluster "$ver" "$(basename "$dir")" stop >/dev/null 2>&1 || true
    sed -i -E "s/^port = ${PG_PORT}\b/port = 5499/" "$conf"
    echo manual > "${dir}/start.conf"
  fi
done

# 3. Create and start the cluster.
if ! pg_lsclusters -h | awk '{print $1"/"$2}' | grep -qx "${PG_MAJOR}/main"; then
  log "creating cluster ${PG_MAJOR}/main on port ${PG_PORT}"
  pg_createcluster "$PG_MAJOR" main --port "$PG_PORT" -- --auth-local=peer --auth-host=scram-sha-256 >/dev/null
fi
if ! pg_lsclusters -h | awk -v v="$PG_MAJOR" '$1==v && $2=="main" {print $4}' | grep -qx online; then
  pg_ctlcluster "$PG_MAJOR" main start
fi

psql_su() { runuser -u postgres -- psql -p "$PG_PORT" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_su -c "alter role postgres with password '${PG_PASSWORD}'"
for db in managemind managemind_test; do
  if [ "$(psql_su -c "select 1 from pg_database where datname = '${db}'")" != "1" ]; then
    psql_su -c "create database ${db}"
  fi
done

# 4. Connection strings for this session (local container only, not secrets).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  base="postgres://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}"
  grep -q '^export DATABASE_URL=' "$CLAUDE_ENV_FILE" 2>/dev/null ||
    echo "export DATABASE_URL=${base}/managemind" >> "$CLAUDE_ENV_FILE"
  grep -q '^export TEST_DATABASE_URL=' "$CLAUDE_ENV_FILE" 2>/dev/null ||
    echo "export TEST_DATABASE_URL=${base}/managemind_test" >> "$CLAUDE_ENV_FILE"
fi

# 5. Dependencies. Plain install (not --frozen-lockfile) so the cached container is reused.
log "installing dependencies"
pnpm install --prefer-offline --reporter=silent

log "ready: Postgres ${PG_MAJOR} on ${PG_PORT}, dependencies installed"
