# Tests for the hashing helpers. Run from the project root with: npm run test:backend

import hashlib

import pytest

from app.security import hash_invite_token, hash_password


def test_hash_password_returns_a_non_plaintext_string():
    hashed = hash_password("correct horse battery staple")
    assert isinstance(hashed, str)
    assert hashed != "correct horse battery staple"
    # bcrypt hashes carry a recognizable prefix.
    assert hashed.startswith("$2")


def test_hash_password_salts_each_hash():
    first_hash = hash_password("same password")
    second_hash = hash_password("same password")
    # bcrypt picks a new random salt every time, so two hashes of the
    # same password must differ.
    assert first_hash != second_hash


def test_hash_password_accepts_a_password_of_exactly_72_bytes():
    password = "a" * 72
    hashed = hash_password(password)
    assert hashed != password


def test_hash_password_rejects_a_password_over_72_bytes():
    password = "a" * 73
    with pytest.raises(ValueError):
        hash_password(password)


def test_hash_password_counts_bytes_not_characters():
    # 40 e-acute characters fit in 72 characters but take 80 UTF-8 bytes,
    # so the byte limit must reject them.
    password = "é" * 40
    with pytest.raises(ValueError):
        hash_password(password)


def test_hash_invite_token_matches_known_sha256():
    expected = hashlib.sha256("demo-invite-pending-abc123".encode()).hexdigest()
    assert hash_invite_token("demo-invite-pending-abc123") == expected


def test_hash_invite_token_is_deterministic():
    first_hash = hash_invite_token("some-token")
    second_hash = hash_invite_token("some-token")
    # The registration lookup compares this hash against the stored one,
    # so the same input must always give the same output.
    assert first_hash == second_hash
