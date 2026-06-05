# Local Produce Exchange

This repository contains Team 4's ICS 613 Local Produce Exchange project.

## Prerequisites

You need a recent version of Node.js. Download it from https://nodejs.org/. That's it.

## Initial Setup

From a terminal at the repo root, run:

```sh
npm run setup
```

## Development

### Frontend

From a terminal at the repo root, run:

```sh
npm run frontend
```

Then open the local URL shown in the terminal. It is usually http://localhost:5173/.

To stop the dev server, press Ctrl+C in the same terminal.

## npm Scripts

Run these commands from the repo root:

| Command | What it's for |
| --- | --- |
| `npm run setup` | Run this once for first-time setup. |
| `npm run frontend` | Run this to do development work on the frontend. |
| `npm run fix:frontend` | Run this if the frontend seems broken; it reinstalls the frontend packages. |
| `npm run typecheck` | Run this to find TypeScript specific errors. |
| `npm run lint` | Run this to find programming and syntax mistakes. |
| `npm run preview` | Run this to preview what the frontend would look like in production. |

## Project Structure

### Frontend Structure

```text
frontend/
  src/           TypeScript and React source code.
    assets/      Images, fonts, and icons imported by code or SCSS.
    components/  Reusable React components.
    pages/       Route-level screens, such as HomePage or LoginPage.
    services/    API calls to the future FastAPI backend.
    styles/      Shared SCSS files.
    main.tsx     Browser entry point.
    App.tsx      Root React component.
```

Use `.tsx` files for React components because they contain JSX markup. Use `.ts` files for TypeScript code that does not render markup, such as API calls or helper functions. TypeScript checks the code before it runs in the browser, which helps catch mismatched values and missing properties early.

## Troubleshooting

If anything is not working, run `npm run setup` first. That fixes most missing or outdated dependency problems.

### Frontend Issues

If something is wrong with the React app, run this from the repo root:

```sh
npm run fix:frontend
```

### Node Issues

If you have a Node error, upgrade Node.js from https://nodejs.org/. The supported range is Node 20.19 or newer within the 20 line, or Node 22.12 or newer.
