# Entry point for the Surplus: A Local Produce Exchange backend.
# Start it from the repo root with: npm run backend

import logging

from fastapi import FastAPI

from app.routers import health, sample_endpoint

logging.basicConfig(
    level=logging.DEBUG,
    format="%(levelname)s %(name)s: %(message)s",
)
logging.getLogger().setLevel(logging.DEBUG)

app = FastAPI(title="Surplus: A Local Produce Exchange API")

# Every route in this router starts with /api.
app.include_router(health.router, prefix="/api")
app.include_router(sample_endpoint.router, prefix="/api")
