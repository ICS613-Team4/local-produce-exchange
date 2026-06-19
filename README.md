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

### Terminal 1: Frontend

In this terminal, run:

```sh
npm run frontend
```

Then open the local URL the terminal prints. It's usually
`http://127.0.0.1:5173`

- The frontend hands any `/api` request off to the backend, so your React pages
  can call the API with no extra setup.

This one keeps running so you can watch the Vite logs, so leave that terminal
open while you work.

To stop it, press Ctrl+C in that same terminal.

### Terminal 2: Backend

In this terminal, run:

```sh
npm run backend
```

The backend runs at `http://127.0.0.1:8000`

- FastAPI builds interactive API docs for you. Once the backend is running,
  open `http://127.0.0.1:8000/docs` for the Swagger UI, where you can read
  every endpoint and try them out from the browser.

This one keeps running so you can watch the backend logs, so leave that terminal
open while you work.

To stop it, press Ctrl+C in that same terminal.

### Terminal 3: Database

For normal development, start PostgreSQL in this terminal:

```sh
npm run db
```

This runs PostgreSQL in the **foreground**. Like the others, it keeps running so
you can see the database logs, so leave that terminal open while you work.

- This also starts pgweb, a small web tool for browsing the database. It comes
  up next to PostgreSQL at `http://localhost:8081` with no login. You don't have
  to use it, and you don't have to start anything extra; it's there when you
  want to look at tables or run a read-only query.

To stop it, press Ctrl+C in that same terminal. That stops both PostgreSQL and
pgweb.

## Database Refresh

**EVERY TIME YOU SIT DOWN TO WORK**, make sure PostgreSQL is running, then run
these in a separate terminal:

```sh
npm run db:migrate
npm run db:seed
```

Do this for first-time setup and after pulling changes too. **These commands are
safe to run every day.**

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
| `npm run db:seed` | Insert missing demo seed rows. Most groups skip when their table already has rows; listings add missing demo rows by owner and title. |
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
  package.json        Frontend scripts, dependencies, and Node engine range.
  package-lock.json   Exact dependency graph used by npm ci.
  .npmrc              Enforces the Node engine range during npm installs.
  vite.config.ts      Vite setup, React plugin, no-cache headers, and /api
                      proxy.
  index.html          Browser HTML shell where Vite mounts React.
  public/             Static files copied as-is, such as browser metadata.
    site.webmanifest  App metadata for installed browser shortcuts.
  src/
    main.tsx          Creates the React root and renders App.
    App.tsx           Top-level route map and app shell.
    pages/            Route screens. Add a page here when a URL needs its
                      own UI.
    services/         API calls. Put fetch code here so pages do not build
                      HTTP requests inline.
    styles/           Shared SCSS loaded by the app.
    utils/            Small helpers that are not React components.
    components/       Shared React components once more than one page needs
                      them.
    assets/           Imported images or fonts once source code needs bundled
                      assets.
```

Use `.tsx` files for React components, since they hold JSX markup. Use plain
`.ts` files for TypeScript that doesn't render markup, like API calls or helper
functions. Frontend tests live near the code they cover, usually beside pages,
services, and utilities.

### Backend Structure

```text
backend/
  pyproject.toml       Backend dependencies, pytest config, and ruff config.
  uv.lock              Exact dependency versions used by Astral uv.
  alembic.ini          Alembic migration settings.
  app/
    main.py            FastAPI app, logging, and router registration.
    db.py              Database engine and session setup.
    dependencies.py    Shared FastAPI dependencies used by route handlers.
    security.py        Password and invite-token hashing helpers.
    seed.py            Demo data seeder. Run migrations before seeding.
    routers/           HTTP endpoint groups. Add a file here for new API routes.
    schemas/           Pydantic request and response shapes used by routes
                       and tests.
    models/            SQLAlchemy table models.
      base.py          Shared SQLAlchemy model base class.
      __init__.py      Imports models so Alembic can see them.
  migrations/
    env.py             Alembic runtime setup. Imports models and uses the
                       app engine.
    versions/          Committed migration history.
  tests/               pytest coverage for routes, models, seed, security,
                       and database behavior.
```

When you add backend behavior, keep the layers separate: routes handle HTTP,
schemas validate input and output, models define tables, and migrations change
the database. Register new model modules in `app/models/__init__.py` so Alembic
can generate migrations from them.

### Database Structure

```text
docker-compose.yml        Defines PostgreSQL, pgweb-init, pgweb, and the
                          database volume.
.env.example              Optional PostgreSQL and pgweb environment values.
scripts/
  pgweb-readonly-role.sql Creates and refreshes the read-only pgweb_ro role.

backend/
  app/
    db.py                 Builds the database URL, engine, and sessions.
    seed.py               Inserts demo data after migrations run.
    models/
      base.py             Shared SQLAlchemy model base class.
      __init__.py         Model registry used by Alembic autogenerate.
  migrations/
    env.py                Connects Alembic to the app models and database
                          engine.
    versions/             Ordered schema changes committed with feature work.
```

PostgreSQL runs in Docker. The `backend/app/db.py` file reads the optional root
`.env` file, falls back to the same defaults as `docker-compose.yml`, and
connects to PostgreSQL on `127.0.0.1`.

Use models for table shape, migrations for schema changes, and `seed.py` for
demo rows. Use pgweb to inspect data. Put durable database changes in
migrations or application code.

### Deployment Structure

```text
.github/
  workflows/
    unit-tests.yml        Reusable lint, build, and test checks.
    deploy.yml            Production deploy workflow for main and manual runs.
docker-compose.yml        Service definitions used by local dev and the VPS.
scripts/
  deploy-remote.sh        VPS-side deploy script. Installs, migrates, seeds,
                          restarts, and checks the API.
  pgweb-readonly-role.sql Keeps pgweb's database login read-only.
```

A VPS is a rented Linux server, and it's what hosts the live site at
https://localharvest.exchange/. The `scripts/deploy-remote.sh` script runs there
on the server, not on your machine. The GitHub Actions workflow copies the new
backend files up to the VPS, runs this script over SSH, and only copies the new
frontend once the script finishes without an error.

The deploy workflow builds `frontend/dist` during the run and uploads it after
the backend health checks pass. That directory is generated output, so don't
commit it.

The script walks through the same steps you'd do by hand to put a new version
online, in order:

1. Check that the production `.env` file exists and that each required key has
   a value: the PostgreSQL keys (`POSTGRES_USER`, `POSTGRES_PASSWORD`,
   `POSTGRES_DB`, `POSTGRES_PORT`), the pgweb browser login
   (`PGWEB_AUTH_USER`, `PGWEB_AUTH_PASS`), and the pgweb database-role password
   (`PGWEB_DB_PASSWORD`). The pgweb database password must use only URL-safe
   characters, and `PGWEB_PORT` must be unset or `8081` in production. If any
   check fails, the script stops before touching the running site.
2. Install the backend dependencies, skipping test-only tools like pytest and
   ruff that production never runs. The script uses `uv` from `PATH`, falling
   back to `$HOME/.local/bin/uv`.
3. Start the PostgreSQL container and wait until its healthcheck passes.
4. Start pgweb. The script probes `http://127.0.0.1:8081` so the deploy log says
   whether pgweb answered. A compose failure while starting pgweb stops the
   deploy before migrations. If pgweb starts but the HTTP probe does not answer,
   the script prints a warning and continues because pgweb is not part of the
   user-facing app.
5. Apply any new database migrations with Alembic.
6. Insert the demo rows with the seed script. Most seed groups skip when their
   table already has rows, and listings add only missing demo rows by owner and
   title, so this is safe to run on every deploy.
7. Restart the backend service.
8. Confirm the deploy worked: call the health endpoint until it answers, then
   send one request that needs the database, so a broken database connection
   fails the deploy here instead of being found later by a user.

If a required `.env` check, dependency install, database start, migration, or seed
step fails, the script bails out before the backend restart, so the previous
backend keeps running. If the restart or health checks fail, the old backend has
already stopped. At that point the API may be down or may be serving the new
backend code until someone fixes forward or rolls back. The new frontend is copied
only after the script passes, so a script failure leaves the old frontend files in
place.

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
    App.test.tsx                Vitest route-registration tests for the React app.
    pages/
      AboutPage.test.tsx        Vitest component tests for the about page.
      CreateListingPage.test.tsx
                                Vitest component tests for listing creation.
      DashboardPage.test.tsx    Vitest component tests for the member dashboard.
      HomePage.test.tsx         Vitest component tests for the home page.
      InvitePage.test.tsx       Vitest component tests for invite links.
      ListingDetailPage.test.tsx
                                Vitest component tests for listing details.
      LoginPage.test.tsx        Vitest component tests for login and logout.
      NotFoundPage.test.tsx     Vitest component tests for unknown routes.
      RegisterPage.test.tsx     Vitest component tests for registration.
    services/
      authService.test.ts       Vitest unit tests for auth API helpers.
      inviteService.test.ts     Vitest unit tests for invite API helpers.
      listingService.test.ts    Vitest unit tests for listing API helpers.
      sampleEndpointService.test.ts
                                Vitest unit tests for the sample API helper.
    utils/
      formatApiResult.test.ts   Vitest unit tests for response text formatting.
```

### Backend Tests

The backend uses pytest. These tests call the route functions, Pydantic models,
and SQLAlchemy models directly, so they don't start an HTTP server.

```text
backend/
  tests/
    test_auth_login.py         pytest unit tests for login behavior.
    test_auth_register.py      pytest unit tests for registration behavior.
    test_invite.py             pytest unit tests for invite behavior.
    test_listing.py            pytest unit tests for create-listing behavior.
    test_listing_detail.py     pytest unit tests for listing-detail behavior.
    test_sample_endpoint.py    pytest unit tests for the sample endpoint.
    test_security.py           pytest unit tests for password and invite-token helpers.
```

### Database Tests

The database tests use pytest and SQLAlchemy, and they run against a real
Postgres test database (`produce_exchange_test`), not SQLite. A shared
`conftest.py` fixture handles it for you: it runs the migrations to build the
schema once, then wraps each test in a transaction it rolls back, so the tests
stay isolated and the suite stays fast. The catch is that `npm run test:backend`
needs the Docker database up first (`npm run db:up`), and CI runs the same tests
against its own Postgres service. `test_db.py` is the one exception, since it
only checks URL strings and touches no database.

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
