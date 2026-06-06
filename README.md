# Local Produce Exchange

This repository contains Team 4's ICS 613 Local Produce Exchange project.

## Prerequisites

### Node

Download Node.js from https://nodejs.org/ and run the installer.

### uv

Install uv from https://docs.astral.sh/uv/getting-started/installation/ by
running the command for your system:

#### Installing uv on Mac

```sh
curl -LsSf https://astral.sh/uv/install.sh | sh
```

#### Installing uv on Windows PowerShell

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

## Initial Setup

Install Node and uv first. Then close every terminal window that was already
open. Open a new terminal and go to the repo root.

From that new terminal, run:

```sh
npm run setup
```

## Development

During full development, keep both terminals open: one running `npm run frontend` and one running `npm run backend`. The frontend forwards any `/api` request to the backend, so React pages can call the API with no extra setup.

The home page has a small validation demo. It sends valid JSON, valid JSON with
the wrong type, and malformed JSON to `POST /api/sample-endpoint`. The response
box shows the HTTP status and the response body.

### Frontend

From a terminal at the repo root, run:

```sh
npm run frontend
```

Then open the local URL shown in the terminal. It is usually `http://127.0.0.1:5173`

To stop the dev server, press Ctrl+C in the same terminal.

### Backend

From a second terminal at the repo root, run:

```sh
npm run backend
```

The backend runs at `http://127.0.0.1:8000`

To stop it, press Ctrl+C in the same terminal.

## npm Scripts

Run these commands from the repo root:

| Command | What it's for |
| --- | --- |
| `npm run setup` | Run this once for first-time setup. Installs frontend and backend dependencies. Safe to run again at any time. |
| `npm run frontend` | Run this to do development work on the frontend. |
| `npm run backend` | Run this to start the FastAPI backend with auto-reload. |
| `npm run fix:frontend` | Run this if the frontend seems broken; it reinstalls the frontend packages. |
| `npm run fix:backend` | Run this if the backend seems broken; it reinstalls every backend package from scratch. |
| `npm run typecheck` | Run this to find TypeScript specific errors. |
| `npm run lint` | Run this to find programming and syntax mistakes. |
| `npm run lint:frontend` | Run this to lint only the frontend. |
| `npm run lint:backend` | Run this to lint only the backend. |
| `npm run tests` | Run this to run all frontend and backend tests. |
| `npm run test:frontend` | Run this to run only the Vitest frontend tests. |
| `npm run test:backend` | Run this to run only the pytest backend tests. |

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
    main.tsx     Browser entry point.
    App.tsx      Root React component.
```

Use `.tsx` files for React components because they contain JSX markup. Use `.ts` files for TypeScript code that does not render markup, such as API calls or helper functions.

### Backend Structure

```text
backend/
  pyproject.toml    Backend dependencies and project info.
  .python-version   The Python version uv installs and uses.
  uv.lock           Exact dependency versions. Committed; do not edit by hand.
  app/
    __init__.py     Marks app as a Python package.
    main.py         FastAPI entry point. Adds the /api prefix.
    routers/        Endpoint groups, one file per feature area.
    models/         SQLAlchemy database models.
    schemas/        Pydantic request and response shapes.
  tests/            pytest unit tests for backend functions and models.
```

Put FastAPI route functions in `app/routers/`. Put Pydantic request and
response shapes in `app/schemas/`. Put future SQLAlchemy database table models
in `app/models/`. Put pytest files in `backend/tests/`, named like
`test_sample_endpoint.py`, so pytest can find them automatically.

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

The backend uses pytest. These tests call route functions and Pydantic models
directly. They do not start an HTTP server.

```text
backend/
  tests/
    test_app_routes.py        pytest unit tests for FastAPI route registration.
    test_health.py            pytest unit tests for the health endpoint.
    test_sample_endpoint.py   pytest unit tests for the sample endpoint.
```

## Troubleshooting

If anything is not working, run `npm run setup` first. That fixes most missing or outdated dependency problems. 

### Frontend Issues

If something is wrong with the React app, run this from the repo root:

```sh
npm run fix:frontend
```

### Backend Issues

If something is wrong with the backend specifically, run this from the repo root:

```sh
npm run fix:backend
```

### uv Issues

If you have a uv error, update uv, open a new terminal window, then run `npm run setup` again:

```sh
uv self update
```

### Node Issues

If you have a Node error, update Node.js from https://nodejs.org/, then run `npm run setup` again.
