# Surplus: A Local Produce Exchange

This is Team 4's project for ICS 613: "Surplus", a local produce exchange.

You can see the live site at https://localharvest.exchange/.

## Prerequisites

### Node

Download Node.js from https://nodejs.org/ and run the installer.

### Astral uv

Install Astral uv from https://docs.astral.sh/uv/getting-started/installation/.
Pick the command for your system:

- On a Mac

  ```sh
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- On Windows

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

### Docker Desktop

Install Docker Desktop from https://www.docker.com/products/docker-desktop/.
You need it to run the PostgreSQL database.

## Initial Setup

Get Node, Astral uv, and Docker Desktop installed first. Clone the repo. Then
close any terminal windows you already had open, open a fresh one, and go to the
repo root.

From that new terminal, run:

```sh
npm run setup
```

## Development

When you're doing full development, keep three terminals open.

### Frontend

In your first terminal, run:

```sh
npm run frontend
```

Then open the local URL the terminal prints. It's usually
`http://127.0.0.1:5173`

The frontend hands any `/api` request off to the backend, so your React pages
can call the API with no extra setup.

To stop it, press Ctrl+C in that same terminal.

### Backend

In your second terminal, run:

```sh
npm run backend
```

The backend runs at `http://127.0.0.1:8000`

This one keeps running so you can watch the backend logs, so leave that terminal
open while you work.

To stop it, press Ctrl+C in that same terminal.

### Database

For normal development, start PostgreSQL in your third terminal:

```sh
npm run db
```

This runs PostgreSQL in the **foreground**. Like the others, it keeps running so
you can see the database logs, so leave that terminal open while you work.

This also starts pgweb, a small web tool for browsing the database. It comes up
next to PostgreSQL at `http://localhost:8081` with no login. You don't have to
use it, and you don't have to start anything extra; it's there when you want to
look at tables or run a read-only query. The two sets of logs share this
terminal.

To stop it, press Ctrl+C in that same terminal. That stops both PostgreSQL and
pgweb.

- First Time Setup

  The first time you run this on a machine, you need to create the tables and
  add the demo rows. With PostgreSQL running, run these in a separate terminal
  window:

  ```sh
  npm run db:migrate
  npm run db:seed
  ```

- After Pulling Changes

  After any pull that might include schema changes, make sure PostgreSQL is
  running, then run this in a separate terminal window:

  ```sh
  npm run db:migrate
  ```

## Database browser (pgweb)

pgweb is a web page for looking at the database. You can browse tables and run
SQL in your browser, with no database client to install.

It's read-only, on purpose. pgweb signs in as a database login that can read
every table but change nothing: PostgreSQL itself rejects any insert, update,
delete, or schema change it tries. Treat pgweb as a window, not a workbench.

Here's why. Every change to this database, both the table layout and the data,
goes through an Alembic migration that's committed to source control. That keeps
each change reviewed, repeatable, and applied the same way on every machine. An
edit typed into a browser would skip all of that and drift your database away
from everyone else's. So when you need to change something, write a migration
(see "Schema Changes" below) instead of reaching for pgweb.

### Locally

There's nothing to set up. When you run `npm run db` (or `npm run db:up`), pgweb
starts next to PostgreSQL. Open `http://localhost:8081` and it's there, already
connected to your local database, with no login. That's it.

### In production

The live one is at `https://db.localharvest.exchange`, behind a shared team
login (the username and password are posted in the team Discord channel, not
here). Like the local one, it's read-only.

## npm Scripts

Run any of these from the repo root:

| Command | What it's for |
| --- | --- |
| `npm run setup` | Run this for first-time setup. Safe to run again. |
| `npm run frontend` | Run this to do development work on the frontend. |
| `npm run backend` | Run this to start the FastAPI backend with auto-reload. |
| `npm run db` | Start the PostgreSQL and pgweb containers in the **foreground**. Keep this terminal open while you work. pgweb is at `http://localhost:8081`. |
| `npm run fix:frontend` | Run this if the frontend package install is broken; it reinstalls the frontend packages. |
| `npm run fix:backend` | Run this if the backend package install is broken; it reinstalls every backend package from scratch. |
| `npm run fix:db` | The catch-all repair for almost any local problem. Reinstalls the frontend and backend packages, then rebuilds the local database from a clean volume and reseeds it. Heads up: this wipes your local database data. |
| `npm run db:up` | Start PostgreSQL and pgweb in the **background** and wait until the database accepts connections. |
| `npm run db:down` | Stop and remove the PostgreSQL and pgweb containers; the database volume and its data are kept. |
| `npm run db:reset` | Stop the containers and delete the database volume. This removes all local database data. |
| `npm run db:migrate` | Apply new database migrations. |
| `npm run db:revision` | Create a new migration after model changes. |
| `npm run db:seed` | Insert demo seed data when the table is empty. |
| `npm run typecheck` | Run the TypeScript type checker. |
| `npm run lint` | Run both frontend and backend linters. |
| `npm run lint:frontend` | Lint only the frontend. |
| `npm run lint:backend` | Lint only the backend. |
| `npm run tests` | Run all frontend and backend tests. |
| `npm run test:frontend` | Run only the Vitest frontend tests. |
| `npm run test:backend` | Run only the pytest backend tests. |

## Project Structure

### Frontend Structure

```text
frontend/
  src/           TypeScript and React source code.
    assets/      Images, fonts, and icons imported by code or SCSS.
    components/  Reusable React components.
    pages/       Route-level screens, such as HomePage or AboutPage.
    services/    API calls to the FastAPI backend.
    styles/      Shared SCSS files.
    utils/       Small helper functions, such as response text formatting.
    main.tsx     Browser entry point.
    App.tsx      Root React component.
```

Use `.tsx` files for React components, since they hold JSX markup. Use plain
`.ts` files for TypeScript that doesn't render markup, like API calls or helper
functions.

### Backend Structure

```text
backend/
  alembic.ini          Alembic migration settings.
  pyproject.toml       Backend dependencies and project info.
  .python-version      The Python version Astral uv installs and uses.
  uv.lock              Exact dependency versions used by Astral uv. Committed; do not edit by hand.
  app/
    __init__.py        Marks app as a Python package.
    db.py              Database engine and session setup.
    main.py            FastAPI entry point. Adds the /api prefix.
    seed.py            Demo data seeder. Run migrations before seeding.
    routers/           Endpoint groups, one file per feature area.
    models/            SQLAlchemy database models.
      base.py          Shared SQLAlchemy model base class.
      sample_data.py   Small demo table for database smoke tests.
    schemas/           Pydantic request and response shapes.
  migrations/          Alembic migration environment and version files.
  tests/               pytest unit tests for backend functions and models.
```

Route functions go in `app/routers/`. Pydantic request and response shapes go
in `app/schemas/`. New SQLAlchemy table models go in `app/models/`. And pytest
files go in `backend/tests/`, named like `test_sample_endpoint.py` so pytest
finds them on its own.

### Database Structure

```text
docker-compose.yml        Local PostgreSQL service.
.env.example              Optional PostgreSQL environment values.

backend/
  alembic.ini             Alembic migration settings.
  migrations/             Alembic migration environment and version files.
  app/
    db.py                 Database URL, engine, and sessions.
    seed.py               Inserts demo data after migrations run.
    models/
      base.py             Shared SQLAlchemy model base class.
      sample_data.py      Demo table used to test the database path.
```

PostgreSQL runs in Docker. The `backend/app/db.py` file reads the optional root
`.env` file, falls back to the same defaults as `docker-compose.yml`, and
connects to PostgreSQL on `127.0.0.1`.

Alembic migrations create and change tables, and the seed script adds demo rows
once the migrations have run. Alembic keeps track of where the database is in
the `alembic_version` table.

### Deployment Structure

```text
scripts/
  deploy-remote.sh        Runs on the VPS during each deploy.
```

A VPS is a rented Linux server, and it's what hosts the live site at
https://localharvest.exchange/. The `scripts/deploy-remote.sh` script runs there
on the server, not on your machine. The GitHub Actions workflow copies the new
backend files up to the VPS, runs this script over SSH, and only copies the new
frontend once the script finishes without an error.

The script walks through the same steps you'd do by hand to put a new version
online, in order:

1. Check that the production `.env` file exists and that each required
   PostgreSQL key (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
   `POSTGRES_PORT`) has a value. If any check fails, the script stops before
   touching the running site.
2. Install the backend dependencies, skipping test-only tools like pytest and
   ruff that production never runs.
3. Start the PostgreSQL container and wait until its healthcheck passes.
4. Apply any new database migrations with Alembic.
5. Insert the demo rows with the seed script. The seed script skips rows that
   are already present, so this is safe to run on every deploy.
6. Restart the backend service.
7. Confirm the deploy worked: call the health endpoint until it answers, then
   send one request that needs the database, so a broken database connection
   fails the deploy here instead of being found later by a user.

If any step fails, the script bails out with an error. That fails the deploy and
leaves the previous version running.

## Schema Changes

Both of these need PostgreSQL running, so start it with `npm run db` or
`npm run db:up` first.

### Adding or Changing Tables

When you want to add or change a database table:

1. Edit or add a model in `backend/app/models/`.
2. Register new model modules in `backend/app/models/__init__.py`.
3. Generate a migration from the repo root:

   ```sh
   npm run db:revision -- "describe the change"
   ```

4. Read the generated migration before using it.
5. Run the migration:

   ```sh
   npm run db:migrate
   ```

6. Commit the migration file with the model change.

### Deleting Tables

> [!WARNING]
> Deleting a table deletes all of its data too, and there's no undo. It happens
> on every machine that runs the migration, so check that nobody still needs the
> data before you start.

When you want to delete a database table:

1. Delete the model file from `backend/app/models/`.
2. Remove the model's import from `backend/app/models/__init__.py`.
3. Generate a migration from the repo root:

   ```sh
   npm run db:revision -- "explain why you dropped the table"
   ```

4. Read the generated migration. The upgrade step should contain
   `op.drop_table` for the table.
5. Run the migration:

   ```sh
   npm run db:migrate
   ```

6. Commit the migration file with the model deletion.

If other tables point at the one you're deleting with foreign keys, delete those
models in the same change, and check that the generated migration drops the
referencing tables or constraints first. PostgreSQL won't drop a table that
another table still points to.

## Tests

### Frontend Tests

The frontend uses Vitest. The component tests render React pages with React
Testing Library and jsdom. The service tests stub out `fetch`, so they don't
need a running backend.

```text
frontend/
  src/
    pages/
      HomePage.test.tsx       Vitest component tests for the home page.
      AboutPage.test.tsx      Vitest component tests for the about page.
    services/
      sampleEndpointService.test.ts
                              Vitest unit tests for the API call helper.
    utils/
      formatApiResult.test.ts Vitest unit tests for response text formatting.
```

### Backend Tests

The backend uses pytest. These tests call the route functions, Pydantic models,
and SQLAlchemy models directly, so they don't start an HTTP server.

```text
backend/
  tests/
    test_sample_endpoint.py   pytest unit tests for the sample endpoint.
```

### Database Tests

The database tests use pytest and SQLAlchemy. `test_seed.py` uses in-memory
SQLite sessions (`sqlite:///:memory:`), and `test_db.py` only checks URL
strings, so both pass without Docker or Postgres running. The real PostgreSQL
only gets exercised when you run the app, the migrations, and the seed script
against the Docker database.

```text
backend/
  tests/
    test_db.py                pytest unit tests for database URL construction.
    test_seed.py              pytest unit tests for the seed script.
```

## GitHub Actions

GitHub Actions handles the automated checks and the deploys for you. There are
two workflow files in `.github/workflows/`. One runs the checks on every pull
request. The other deploys the `main` branch to the live site at
https://localharvest.exchange/. Both run on GitHub's own Linux machines, so
there's nothing for you to run from your laptop.

### Checks (`unit-tests.yml`)

This one is named "Checks", and it runs in three situations:

- On every pull request.
- When another workflow calls it (`workflow_call`). The Deploy workflow reuses
  it so the same checks run before a deploy.
- When you start it by hand from the Actions tab (`workflow_dispatch`).

It has a single job that runs on `ubuntu-latest` and gives up after 15 minutes
if it's still going. Here are the steps, in order:

1. Check out the repository.
2. Set up Node.js 22, with the npm cache keyed to `frontend/package-lock.json`.
3. Set up Astral uv (pinned to release 8.2.0).
4. Install all dependencies with `npm run setup`.
5. Run the linters with `npm run lint`.
6. Build the frontend with `npm run build`, which runs the TypeScript compiler
   and then bundles with vite. This catches type errors and build-only
   failures such as Sass errors.
7. Run the unit tests with `npm test`.

If you push a newer commit to the same branch or pull request while a run is
going, GitHub cancels the older one, since it's testing a commit that's no
longer the latest.

### Deploy (`deploy.yml`)

This one is named "Deploy", and it runs in two situations:

- On every push to the `main` branch.
- When you start it by hand from the Actions tab (`workflow_dispatch`), for a
  manual redeploy.

Two deploys never run at the same time. The workflow uses a concurrency group
named `deploy-production` that won't cancel a run that's already going, so a new
deploy waits for the current one to finish instead of getting cut off halfway.

It has two jobs:

1. `checks` reuses the Checks workflow above. If the linters, the build, or the
   tests fail, the deploy stops right here and nothing reaches the server.
2. `deploy` runs only after `checks` passes. It also has a guard,
   `if: github.ref == 'refs/heads/main'`, so a manual run from any branch other
   than `main` can't deploy. It runs on `ubuntu-latest` and gives up after 15
   minutes too. Here are its steps, in order:
   1. Check out the repository.
   2. Set up Node.js 22.
   3. Install rsync, the tool it uses to copy files to the server.
   4. Build the frontend. The `checks` job already built it, but separate jobs
      don't share files, so this job builds its own copy to upload.
   5. Set up SSH from the repository secrets (see below). This writes the deploy
      key and the known-hosts line so the runner can reach the server and trust
      it.
   6. Copy `backend/`, `docker-compose.yml`, and `scripts/` to the VPS with
      rsync. The copy uses `--delete` to clear out files that no longer exist,
      and it skips the server-only `backend/.venv`, the `.env` file, the
      `docker-compose.override.yml` file, and the Python cache folders.
   7. Run `scripts/deploy-remote.sh` on the server over SSH. That script
      installs the dependencies, applies the migrations, restarts the backend,
      and runs the health checks (see "Deployment Structure" above).
   8. Copy the freshly built `frontend/dist` up to the VPS, but only after step
      7 passes its health checks. nginx serves the frontend straight from disk,
      so copying it last means a failure partway through never shows a new UI
      against a backend that isn't ready.

### Repository secrets

The Deploy workflow reads four secrets, which live under Settings -> Secrets and
variables -> Actions in the GitHub repository:

- `DEPLOY_SSH_KEY`: the private SSH key the runner uses to reach the deploy
  user on the server.
- `DEPLOY_KNOWN_HOSTS`: the server's SSH host key line, so the runner trusts
  the right machine.
- `DEPLOY_USER`: the login name on the server.
- `DEPLOY_HOST`: the server address.

## Database Backups

The live database on the server backs itself up every 6 hours. A systemd timer
runs `pg_dump`, gzips the result, and keeps the dumps for 30 days, so a bad
migration or an accidental delete costs you at most the last 6 hours of changes.
You don't run any of this yourself; it happens on the server.

Heads up: every backup copy lives on that one server, so this guards against
losing data, not against losing the whole machine. An off-box copy is a planned
next step.

## Troubleshooting

Whatever the issue, run `npm run setup` first.

### Frontend Issues

If your React package install is broken, run this from the repo root:

```sh
npm run fix:frontend
```

### Backend Issues

If your backend package install is broken, run this from the repo root:

```sh
npm run fix:backend
```

### Database Issues

Heads up: this wipes your local database data and starts you fresh. To rebuild
your local database from a clean volume and reseed it, run this from the repo
root:

```sh
npm run fix:db
```

### Astral uv Issues

If you hit an Astral uv error, update Astral uv, open a new terminal window, then
run `npm run setup` again:

```sh
uv self update
```

### Node Issues

If you hit a Node error, update Node.js from https://nodejs.org/, then run
`npm run setup` again.
