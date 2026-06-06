# Surplus: A Local Produce Exchange

This repository contains Team 4's ICS 613 Surplus: A Local Produce Exchange project.

## Prerequisites

### Node

Download Node.js from https://nodejs.org/ and run the installer.

### Astral uv

Install Astral uv from https://docs.astral.sh/uv/getting-started/installation/ by
running the command for your system:

- Installing on Mac

  ```sh
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

- Installing on Windows

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  ```

### Docker Desktop

Install Docker Desktop from https://www.docker.com/products/docker-desktop/.
It is required for the PostgreSQL database.

## Initial Setup

Install Node, Astral uv, and Docker Desktop first. Then close every terminal window
that was already open. Open a new terminal and go to the repo root.

From the new terminal, run:

```sh
npm run setup
```

## Development

During full development, keep three terminals open.

### Frontend

In the first terminal, run:

```sh
npm run frontend
```

Then open the local URL shown in the terminal. It is usually
`http://127.0.0.1:5173`

The frontend forwards any `/api` request to the backend, so React pages can
call the API with no extra setup.

To stop the frontend dev server, press Ctrl+C in the same terminal.

### Backend

In the second terminal, run:

```sh
npm run backend
```

The backend runs at `http://127.0.0.1:8000`

This command keeps running so you can see backend logs. Leave that terminal
open while you work.

To stop the backend dev server, press Ctrl+C in the same terminal.

### Database

In the third terminal, start PostgreSQL:

```sh
npm run db
```

This command runs PostgreSQL in the **foreground**. It keeps running so you can
see database logs. Leave that terminal open while you work.

After PostgreSQL is running, open another terminal and run this once to insert
the demo rows:

```sh
npm run db:seed
```

To stop the dev db server, press Ctrl+C in the same terminal.

## npm Scripts

Run these commands from the repo root:

| Command | What it's for |
| --- | --- |
| `npm run setup` | Run this for first-time setup. Safe to run again. |
| `npm run frontend` | Run this to do development work on the frontend. |
| `npm run backend` | Run this to start the FastAPI backend with auto-reload. |
| `npm run fix:frontend` | Run this if the frontend package install is broken; it reinstalls the frontend packages. |
| `npm run fix:backend` | Run this if the backend package install is broken; it reinstalls every backend package from scratch. |
| `npm run db` | Start the PostgreSQL container in the **foreground**. Keep this terminal open while you work. |
| `npm run db:up` | Start the PostgreSQL container in the **background**. Use this for reset and seed commands. |
| `npm run db:down` | Stop and remove the PostgreSQL container; the database volume and its data are kept. |
| `npm run db:reset` | Stop PostgreSQL and delete the database volume. This removes all local database data. |
| `npm run db:seed` | Create missing tables and insert demo seed data when the table is empty. |
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

Use `.tsx` files for React components because they contain JSX markup. Use
`.ts` files for TypeScript code that does not render markup, such as API calls
or helper functions.

### Backend Structure

```text
backend/
  pyproject.toml       Backend dependencies and project info.
  .python-version      The Python version Astral uv installs and uses.
  uv.lock              Exact dependency versions used by Astral uv. Committed; do not edit by hand.
  app/
    __init__.py        Marks app as a Python package.
    db.py              Database engine and session setup.
    main.py            FastAPI entry point. Adds the /api prefix.
    seed.py            Demo data seeder.
    routers/           Endpoint groups, one file per feature area.
    models/            SQLAlchemy database models.
      base.py          Shared SQLAlchemy model base class.
      sample_data.py   Small demo table for database smoke tests.
    schemas/           Pydantic request and response shapes.
  tests/               pytest unit tests for backend functions and models.
```

Put FastAPI route functions in `app/routers/`. Put Pydantic request and
response shapes in `app/schemas/`. Put future SQLAlchemy database table models
in `app/models/`. Put pytest files in `backend/tests/`, named like
`test_sample_endpoint.py`, so pytest can find them automatically.

### Database Structure

```text
docker-compose.yml        Local PostgreSQL service.
.env.example              Optional PostgreSQL environment values.

backend/
  app/
    db.py                 Database URL, engine, and sessions.
    seed.py               Creates missing tables and inserts demo data.
    models/
      base.py             Shared SQLAlchemy model base class.
      sample_data.py      Demo table used to test the database path.
```

PostgreSQL runs in Docker. The `backend/app/db.py` file reads the optional root
`.env` file, uses the same defaults as `docker-compose.yml`, and connects to
PostgreSQL on `127.0.0.1`.

The seed script uses SQLAlchemy to create any missing tables and insert demo
rows.

## Tests

### Frontend Tests

The frontend uses Vitest. Component tests render React pages with React Testing
Library and jsdom. Service tests stub `fetch`, so they do not need a running
backend.

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

The backend uses pytest. These tests call route functions, Pydantic models, and
SQLAlchemy models directly. They do not start an HTTP server.

```text
backend/
  tests/
    test_sample_endpoint.py   pytest unit tests for the sample endpoint.
```

### Database Tests

The database tests use pytest and SQLAlchemy. `test_seed.py` uses in-memory
SQLite sessions (`sqlite:///:memory:`); `test_db.py` only checks URL strings.
Both pass without Docker or Postgres running. Real PostgreSQL is exercised by
the manual verification steps.

```text
backend/
  tests/
    test_db.py                pytest unit tests for database URL construction.
    test_seed.py              pytest unit tests for the seed script.
```

## Troubleshooting

For any issue, run `npm run setup` first. This refreshes the frontend packages
and makes sure the backend packages match the committed lock files. Many errors
after a fresh clone, branch switch, or pull come from missing or outdated local
packages.

### Frontend Issues

If the React package install is broken, run this from the repo root:

```sh
npm run fix:frontend
```

### Backend Issues

If the backend package install is broken, run this from the repo root:

```sh
npm run fix:backend
```

### Database Issues

Reset and seed from a fresh volume:

```sh
npm run db:reset
npm run db:up
npm run db:seed
```

### Astral uv Issues

If you have an Astral uv error, update Astral uv, open a new terminal window, then run
`npm run setup` again:

```sh
uv self update
```

### Node Issues

If you have a Node error, update Node.js from https://nodejs.org/, then run
`npm run setup` again.
