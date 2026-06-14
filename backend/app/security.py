# Hashing helpers for passwords and invite tokens.

import hashlib

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
