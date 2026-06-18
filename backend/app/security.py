# Hashing helpers for passwords and invite tokens, plus a generator that
# mints a fresh random invite token.

import hashlib
import secrets

import bcrypt


def hash_password(plain_password: str) -> str:
    # bcrypt reads at most 72 bytes of input, so a longer password must be
    # rejected here instead of being silently cut short.
    password_bytes = plain_password.encode("utf-8")
    if len(password_bytes) > 72:
        raise ValueError("Password is longer than 72 bytes, which bcrypt cannot hash.")
    hashed_bytes = bcrypt.hashpw(password_bytes, bcrypt.gensalt())
    return hashed_bytes.decode("utf-8")


def verify_password(plain_password: str, hashed: str) -> bool:
    # Returns True when the plaintext matches the stored bcrypt hash.
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed.encode("utf-8"))


def hash_invite_token(plaintext: str) -> str:
    # Invite tokens are stored as a sha256 hash, never as plaintext.
    # The seed script and the registration route both use this function,
    # so the lookup hash always matches the stored hash.
    return hashlib.sha256(plaintext.encode()).hexdigest()


def generate_invite_token() -> str:
    # Makes a new, hard-to-guess invite token. secrets.token_urlsafe is the
    # standard library tool for unguessable codes; 32 bytes of randomness is
    # plenty. The result is URL-safe text, so it drops cleanly into a link.
    return secrets.token_urlsafe(32)
