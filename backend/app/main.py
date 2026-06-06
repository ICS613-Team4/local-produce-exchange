# Entry point for the Local Produce Exchange backend.
# Start it from the repo root with: npm run backend

import logging

from fastapi import FastAPI

from app.routers import health

logging.basicConfig(
    level=logging.DEBUG,
    format="%(levelname)s %(name)s: %(message)s",
)
logging.getLogger().setLevel(logging.DEBUG)

app = FastAPI(title="Local Produce Exchange API")

# Every route in this router starts with /api.
app.include_router(health.router, prefix="/api")
