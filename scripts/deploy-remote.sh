#!/usr/bin/env bash
# Runs on the VPS during every deploy. The GitHub Actions workflow calls
# this script over SSH after copying the backend files, and copies the
# new frontend only after this script finishes successfully.

set -euo pipefail

APP_ROOT="/opt/produce-exchange/app"
UV="$HOME/.local/bin/uv"

cd "$APP_ROOT"

# Stop at once if the production .env is missing or unreadable. Without
# it, Docker Compose and the app both fall back to the produce/produce
# defaults, and a first deploy would initialize the database volume with
# those default credentials while reporting success.
if [ ! -r "$APP_ROOT/.env" ]; then
    echo "Missing or unreadable $APP_ROOT/.env. Refusing to deploy." >&2
    exit 1
fi

# The same fallback happens one variable at a time: any key missing from
# .env quietly gets its default. So a present-but-incomplete .env is as
# dangerous as a missing one. Check that each required key has a value.
# The PGWEB_AUTH_* keys (the pgweb web login) and PGWEB_DB_PASSWORD (the
# password for the read-only pgweb_ro database role) have no safe default, so
# they are required here too. An empty web login would serve the database with
# no password; a missing role password would not match the pgweb_ro role on the
# server. The trailing "." in the grep already rejects an empty value.
for required_key in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_PORT PGWEB_AUTH_USER PGWEB_AUTH_PASS PGWEB_DB_PASSWORD; do
    if ! grep -q "^${required_key}=." "$APP_ROOT/.env"; then
        echo "No ${required_key} value in $APP_ROOT/.env. Refusing to deploy." >&2
        exit 1
    fi
done

# Install backend dependencies into backend/.venv. --no-dev skips
# test-only tools like pytest and ruff that production never runs.
"$UV" sync --locked --no-dev --directory backend

# Make sure the database container matches the compose file and is
# healthy before anything talks to it. --wait uses the healthcheck.
docker compose up -d --wait db

# Start the pgweb database browser. It waits on the db healthcheck, so it
# comes up once the database is ready. pgweb is a non-critical admin tool,
# so problems here only print a warning; they never fail the deploy. nginx
# shows a maintenance page whenever pgweb is down.
docker compose up -d pgweb

# Confirm pgweb is listening, but do not gate the deploy on it. With auth
# turned on, an unauthenticated probe returns 401, which still proves pgweb
# is up. A reply of 000 means nothing is listening yet, so retry a few times.
pgweb_attempt=1
while [ "$pgweb_attempt" -le 10 ]; do
    pgweb_status=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081 || true)
    if [ "$pgweb_status" != "000" ]; then
        echo "pgweb is up (HTTP ${pgweb_status})."
        break
    fi
    if [ "$pgweb_attempt" -eq 10 ]; then
        echo "WARNING: pgweb did not come up; continuing without it." >&2
        break
    fi
    pgweb_attempt=$((pgweb_attempt + 1))
    sleep 2
done

# Apply any new database migrations. Alembic reads alembic.ini from this
# folder, and migrations/env.py connects with the same settings as the
# app, so the root .env file is all the configuration it needs. The
# upgrade runs inside one transaction, and the table and column changes
# autogenerate writes can all roll back in Postgres: if one fails, the
# database returns to where it was and the script stops here, before the
# restart, so the old backend keeps running against the old schema.
# (Operations that cannot run in a transaction, like CREATE INDEX
# CONCURRENTLY, are the exception; back up before shipping one.)
cd "$APP_ROOT/backend"
.venv/bin/alembic upgrade head

# Insert the demo rows. Tables come from the migrations above; the seed
# script only adds data, and it skips the inserts when rows are already
# present, so this is safe on every deploy.
.venv/bin/python -m app.seed

# Restart the backend. The sudoers file on the VPS allows the deploy
# user to run exactly this one command as root.
sudo -n /usr/bin/systemctl restart produce-backend.service

# Give uvicorn a moment, then confirm the API answers.
attempt=1
while [ "$attempt" -le 10 ]; do
    if curl --silent --fail http://127.0.0.1:8000/api/health; then
        echo ""
        echo "Health check passed."
        break
    fi
    if [ "$attempt" -eq 10 ]; then
        echo "Backend did not become healthy after the restart." >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
done

# One request that needs the database, so a broken database connection
# fails the deploy instead of being found later by a user.
echo "Running the database smoke test."
curl --silent --fail --show-error -X POST http://127.0.0.1:8000/api/sample-endpoint \
    -H "Content-Type: application/json" \
    --data '{"foo":"deploy-smoke","baz":1}'
echo ""
echo "Deploy finished."
