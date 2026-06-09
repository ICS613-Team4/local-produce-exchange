# Deploying Local Produce Exchange

This document explains how the production deploy works and how to operate
the live server. The site runs at https://localharvest.exchange.

Every push to the `main` branch deploys automatically through GitHub
Actions. You can also start a deploy by hand from the Actions tab (see
"Manual redeploy"). There is nothing to run from a laptop.

## How a deploy flows

The deploy lives in two workflow files under `.github/workflows/`:

- `unit-tests.yml` (named "Checks"): lints, builds the frontend, and runs
  the tests. It runs on every pull request, and the Deploy workflow calls
  it as a reusable step.
- `deploy.yml` (named "Deploy"): runs on every push to `main` and on a
  manual trigger.

The Deploy workflow has two jobs:

1. `checks`: calls the Checks workflow. If lint, build, or tests fail, the
   deploy stops here and nothing reaches the server.
2. `deploy`: runs only after `checks` passes. In order, it
   1. builds the frontend on the GitHub runner (the server never gets
      Node),
   2. copies `backend/`, `docker-compose.yml`, and `scripts/` to the
      server with rsync,
   3. runs `scripts/deploy-remote.sh` on the server over SSH, and
   4. copies the freshly built `frontend/dist` to the server, but only
      after step 3 succeeds.

`scripts/deploy-remote.sh` is the server side of every deploy. It checks
that the `.env` file is present and complete, installs backend
dependencies with `uv`, makes sure the database container is up and
healthy, applies any new database migrations (`alembic upgrade head`),
seeds the demo rows if the table is empty, restarts the backend, waits
for `/api/health`, and finishes with one request that touches the
database.

The frontend is copied last on purpose. nginx serves `frontend/dist`
straight from disk, so the new pages go live the moment the files land.
Copying them after the backend is migrated and healthy means a failure
partway through never shows a new UI against a backend that is not ready.

## Architecture

- nginx handles HTTPS, serves the built React files from `frontend/dist`,
  and sends any unknown path back to `index.html` so React Router can do
  client-side routing.
- nginx forwards `/api/` to the backend at `127.0.0.1:8000`.
- The backend is uvicorn running FastAPI, started by systemd as the
  `produce-backend.service` unit, one worker, as the `deploy` user.
- PostgreSQL runs in a Docker container from the repo's
  `docker-compose.yml`, listening on `127.0.0.1` only.
- The browser talks to one origin (the domain), so there are no CORS
  settings to manage. The frontend already uses relative `/api/...` paths.

## The server (vps2)

- Host: Vultr, 45.77.209.138, Debian 13, 961MB RAM plus 3GB swap, 23GB
  disk.
- Admin login: `ssh vps2` (an alias in `C:\Users\jeffr\.ssh\config`, user
  `jeff`, with passwordless sudo).
- App directory: `/opt/produce-exchange/app`, owned by the `deploy` user.
- Domain: `localharvest.exchange` (covers the apex and `www`).

### What provisioning installed

- Packages: nginx, ufw, rsync, curl, gnupg, ca-certificates, and Docker
  Engine plus the compose plugin from Docker's official apt repository.
- `/etc/docker/daemon.json`: json-file logging capped at three files of
  10MB each per container, so container logs cannot fill the disk.
- User `deploy` (in the `docker` group): owns the app directory, runs the
  backend, and receives deploys. Its only login credential is the deploy
  SSH key.
- `/etc/sudoers.d/deploy`: lets `deploy` run exactly
  `systemctl restart produce-backend.service` and
  `systemctl status produce-backend.service` as root, nothing else.
- `uv` for the deploy user at `~/.local/bin/uv`, with Python 3.14.2 (the
  version `backend/.python-version` pins).
- UFW firewall: allows SSH, 80, and 443; everything else is closed.
  Postgres is also unreachable from outside because Docker publishes it on
  `127.0.0.1` only.
- `/opt/produce-exchange/app/.env` (mode 600, owner `deploy`): the only
  copy of the real database password. It is never committed and never
  copied by a deploy.
- `produce-backend.service` (enabled): uvicorn, one worker,
  `127.0.0.1:8000`, `LOG_LEVEL=INFO`, restarts on failure.
- TLS: private key at `/etc/ssl/private/produce.key` (never leaves the
  server), certificate chain at `/etc/ssl/produce/fullchain.pem` (Sectigo
  leaf plus intermediate bundle, valid until 2026-12-21, covers apex and
  `www`).
- nginx site `produce-exchange`: redirects port 80 to HTTPS, serves
  `frontend/dist` with the SPA fallback, and proxies `/api/`.

## GitHub repository secrets

The Deploy workflow reads four secrets (Settings -> Secrets and variables
-> Actions):

- `DEPLOY_SSH_KEY`: the private half of the deploy key. The workflow
  writes it onto the runner and uses it to reach the `deploy` user.
- `DEPLOY_HOST`: the server address, `45.77.209.138`.
- `DEPLOY_USER`: the login name, `deploy`.
- `DEPLOY_KNOWN_HOSTS`: the server's SSH host key line, so the runner
  trusts the right machine instead of scanning for it at deploy time.

## Manual redeploy

Open the Actions tab, choose the Deploy workflow, and use the "Run
workflow" button. The deploy job has a guard
(`if: github.ref == 'refs/heads/main'`), so a manual run only deploys from
`main`. A manual run does the same steps as a push: rebuild, copy,
migrate, restart. Because the database steps skip work that is already
done (see "Database migrations" and "Seeding"), redeploying the same
commit is safe.

## Rollback

- Code: revert the bad merge on `main`. The revert is a normal push to
  `main`, so it triggers a deploy that puts the previous code back.
- Frontend: there is no separate frontend rollback; reverting the merge
  redeploys the matching frontend along with the backend.
- Migration caveat: reverting code does not undo a database migration. See
  the next section.

## Database migrations

Schema changes are managed by Alembic. The schema is described by
migration files in `backend/migrations/versions/`, and each deploy runs
`alembic upgrade head` to apply any that the database has not seen yet.

### Shipping a schema change

1. Edit or add the model files under `backend/app/models/`.
2. Make sure any new model module is imported in
   `backend/app/models/__init__.py`. Alembic only sees tables that an
   import has registered. If you forget the import, Alembic does not see
   the table and writes a `drop_table` for it into the generated
   migration, which would delete it. A surprise `drop_table` in the
   generated file is the warning sign.
3. Generate the migration: `npm run db:revision -- "short message"`.
4. Read the generated file under `backend/migrations/versions/` and
   confirm it does what you expect.
5. Commit the migration file together with the code change.

The next deploy applies it automatically. Keep migrations additive (add
tables and columns; do not drop or rename in the same change as the code
that stops using them), so the brief moment when the old code runs against
the new schema stays safe.

### Check what the live database is at

    ssh vps2 "cd /opt/produce-exchange/app/backend && sudo -u deploy .venv/bin/alembic current"

This prints the current revision id. The `sudo -u deploy` part matters:
only the `deploy` user can read the `.env` file that holds the database
password.

### Why a revert does not undo a migration

A migration that has already run leaves the database at the newer
revision. Reverting the merge removes the migration file from the repo but
does not change the database. The next deploy then runs
`alembic upgrade head`, cannot find the revision the database reports, and
fails with an unknown-revision error. The fixes, in order of preference:
write a new migration that undoes the change, or restore the backup you
took before the deploy. A manual `alembic downgrade` is a last resort, not
the normal path.

### Rules

- Never edit a migration that has already run in production. Write a new
  revision instead.
- Take a manual backup (below) before merging any PR that contains a
  migration.

## Seeding

Every deploy runs the seed script. It inserts the three demo rows only
when the table is empty, so it does nothing on a database that already has
data. If someone empties the `sample_data` table in production on purpose,
the next deploy puts the three demo rows back, because the seed skips
inserting only when at least one row is already present.

## Database backup and restore (manual)

Run these from Git Bash on the admin machine. Take a backup before any
schema-changing deploy, before rotating the password, or before anything
that touches the data volume:

    ssh vps2 "cd /opt/produce-exchange/app && sudo docker compose exec -T db pg_dump -U produce produce_exchange" > backup-$(date +%Y%m%d-%H%M%S).sql

Restore into a running database container. To restore into an empty
database, recreate the volume first:

    ssh vps2 "cd /opt/produce-exchange/app && sudo docker compose down --volumes && sudo docker compose up -d --wait db"
    ssh vps2 "cd /opt/produce-exchange/app && sudo docker compose exec -T db psql -U produce -d produce_exchange" < backup-FILE.sql

The `sudo` is needed because `ssh vps2` logs in as `jeff`, who is not in
the docker group. Keep the .sql files on the admin machine, not the
server. The dump includes Alembic's `alembic_version` table, so a restored
database remembers which migrations it already has, and the next deploy
applies only newer ones. After an empty-volume restore, the next deploy's
seed step sees rows and skips itself.

## Database password rotation

The postgres image reads `.env` only when it first creates an empty data
volume. After that the password lives inside the volume, so editing `.env`
by itself makes the backend and the database disagree and login fails.
Rotate in this order (as `jeff`):

1. Change it in the database:

        ssh vps2 "cd /opt/produce-exchange/app && sudo docker compose exec db psql -U produce -d produce_exchange -c \"ALTER ROLE produce WITH PASSWORD 'newvalue'\""

2. Edit `/opt/produce-exchange/app/.env` so `POSTGRES_PASSWORD` matches.
3. Restart the backend:

        ssh vps2 "sudo systemctl restart produce-backend.service"

## Certificate rotation

The certificate expires 2026-12-21. With the new issued files in
`C:\Users\jeffr\MCS\ics613\ssl\`:

    scp C:\Users\jeffr\MCS\ics613\ssl\localharvest_exchange.crt vps2:/tmp/
    scp C:\Users\jeffr\MCS\ics613\ssl\localharvest_exchange.ca-bundle vps2:/tmp/
    ssh vps2 "sudo install -m 644 /tmp/localharvest_exchange.crt /etc/ssl/produce/ && sudo install -m 644 /tmp/localharvest_exchange.ca-bundle /etc/ssl/produce/ && sudo sh -c 'cat /etc/ssl/produce/localharvest_exchange.crt /etc/ssl/produce/localharvest_exchange.ca-bundle > /etc/ssl/produce/fullchain.pem' && sudo chmod 644 /etc/ssl/produce/fullchain.pem && rm /tmp/localharvest_exchange.crt /tmp/localharvest_exchange.ca-bundle && sudo nginx -t && sudo systemctl reload nginx"

The private key only changes if a new CSR was generated. Reusing the
existing CSR keeps `/etc/ssl/private/produce.key` valid.

## Docker log rotation

`/etc/docker/daemon.json` caps container logs at three files of 10MB each.
Confirm the driver with:

    ssh vps2 "sudo docker info --format '{{.LoggingDriver}}'"

It should print `json-file`. If disk use ever climbs, look under
`/var/lib/docker/containers`.

## Self-healing

The server recovers from these failures on its own:

- Reboot: Docker restarts the database container (the
  `docker-compose.override.yml` file sets `restart: unless-stopped`),
  systemd restarts the backend (the unit is enabled), and nginx starts.
  No manual step.
- Backend process dies: systemd restarts uvicorn within a few seconds
  (`Restart=always`).
- Database container crashes: the Docker restart policy starts it again,
  and the backend reconnects on the next request (the connection pool
  checks each connection before using it).

One case stays manual on purpose: `docker stop` is treated as an operator
decision, so the restart policy leaves it stopped. Start it again with:

    ssh vps2 "cd /opt/produce-exchange/app && sudo docker compose up -d db"
