# Entry point for the Surplus: A Local Produce Exchange backend.
# Start it from the repo root with: npm run backend

import logging
import os

from fastapi import FastAPI

from app.routers import (
    auth,
    claim,
    exchange_history,
    health,
    invite,
    listing,
    listing_photo,
    members,
    notification,
    sample_endpoint,
    thread,
)


def get_log_level():
    log_level_name = os.environ.get("LOG_LEVEL", "DEBUG").upper()

    if log_level_name == "DEBUG":
        return logging.DEBUG
    if log_level_name == "INFO":
        return logging.INFO
    if log_level_name == "WARNING":
        return logging.WARNING
    if log_level_name == "ERROR":
        return logging.ERROR
    if log_level_name == "CRITICAL":
        return logging.CRITICAL

    return logging.INFO


log_level = get_log_level()

logging.basicConfig(
    level=log_level,
    format="%(levelname)s %(name)s: %(message)s",
)
logging.getLogger().setLevel(log_level)

app = FastAPI(title="Surplus: A Local Produce Exchange API")

# Every route in this router starts with /api.
app.include_router(auth.router, prefix="/api")
app.include_router(claim.router, prefix="/api")
app.include_router(exchange_history.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(invite.router, prefix="/api")
app.include_router(listing.router, prefix="/api")
app.include_router(listing_photo.router, prefix="/api")
app.include_router(members.router, prefix="/api")
app.include_router(notification.router, prefix="/api")
app.include_router(sample_endpoint.router, prefix="/api")
app.include_router(thread.router, prefix="/api")
