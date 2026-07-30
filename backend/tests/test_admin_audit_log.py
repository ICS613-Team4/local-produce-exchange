# Tests for the admin audit log (US-35): the core list/PDF functions and the
# record_audit_log_entry helper.
# Run from the project root with: npm run test:backend

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import Range

from app.audit_log import record_audit_log_entry
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.listing import Listing
from app.models.member import Member
from app.routers.admin_audit_log import generate_audit_log_pdf, list_audit_log
from app.schemas.admin_audit_log import AdminAuditLogEntry


def insert_member(session, name="Admin Alice", email="admin@example.com", role="admin"):
    member = Member(
        name=name,
        email=email,
        password_hash="not-a-real-hash",
        role=role,
        status="active",
    )
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner):
    start = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc)
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=Range(start, end, bounds="[)"),
        status="active",
    )
    session.add(listing)
    session.commit()
    return listing


# --- record_audit_log_entry ---


def test_record_audit_log_entry_is_add_only_and_not_visible_until_commit(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")

    record_audit_log_entry(db_session, admin.id, "member_suspended", "member", member.id)

    # Not committed yet: a fresh query on the same session sees it (it's in
    # the session's own pending state), but nothing has been persisted to
    # disk that a rollback couldn't undo.
    db_session.rollback()
    entry = db_session.scalars(
        select(AdminAuditLog).where(AdminAuditLog.target_id == member.id)
    ).first()
    assert entry is None


def test_record_audit_log_entry_defaults_occurred_at_to_now(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")

    record_audit_log_entry(db_session, admin.id, "member_suspended", "member", member.id)
    db_session.commit()

    entry = db_session.scalars(
        select(AdminAuditLog).where(AdminAuditLog.target_id == member.id)
    ).first()
    assert entry.created_at is not None


# --- list_audit_log ---


def test_list_audit_log_returns_entries_newest_first(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")
    now = datetime.now(timezone.utc)
    record_audit_log_entry(db_session, admin.id, "member_suspended", "member", member.id, occurred_at=now - timedelta(days=1))
    record_audit_log_entry(db_session, admin.id, "member_unsuspended", "member", member.id, occurred_at=now)
    db_session.commit()

    result = list_audit_log(db_session, None, None)

    assert [e.action for e in result.entries] == ["member_unsuspended", "member_suspended"]
    assert result.total_count == 2


def test_list_audit_log_filters_by_date_range(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")
    record_audit_log_entry(
        db_session, admin.id, "member_suspended", "member", member.id,
        occurred_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    record_audit_log_entry(
        db_session, admin.id, "member_unsuspended", "member", member.id,
        occurred_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    db_session.commit()

    result = list_audit_log(db_session, date(2026, 5, 1), date(2026, 12, 31))

    assert len(result.entries) == 1
    assert result.entries[0].action == "member_unsuspended"


def test_list_audit_log_respects_limit(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")
    for _ in range(3):
        record_audit_log_entry(db_session, admin.id, "member_suspended", "member", member.id)
    db_session.commit()

    result = list_audit_log(db_session, None, None, limit=2)

    assert len(result.entries) == 2


def test_list_audit_log_handles_null_admin_id(db_session):
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")
    record_audit_log_entry(db_session, None, "member_unsuspended", "member", member.id)
    db_session.commit()

    result = list_audit_log(db_session, None, None)

    assert result.entries[0].admin_id is None
    assert result.entries[0].admin_name is None


def test_list_audit_log_resolves_member_target_label(db_session):
    admin = insert_member(db_session)
    member = insert_member(db_session, name="Regular Bob", email="bob@example.com", role="member")
    record_audit_log_entry(db_session, admin.id, "member_suspended", "member", member.id)
    db_session.commit()

    result = list_audit_log(db_session, None, None)

    assert result.entries[0].target_label == "Regular Bob"
    assert result.entries[0].admin_name == "Admin Alice"


def test_list_audit_log_resolves_listing_target_label(db_session):
    admin = insert_member(db_session)
    listing = insert_listing(db_session, admin)
    record_audit_log_entry(db_session, admin.id, "listing_deactivated", "listing", listing.id)
    db_session.commit()

    result = list_audit_log(db_session, None, None)

    assert result.entries[0].target_label == "Fresh Tomatoes"


def test_list_audit_log_leaves_member_report_target_label_none(db_session):
    admin = insert_member(db_session)
    record_audit_log_entry(db_session, admin.id, "member_report_resolved", "member_report", uuid.uuid4())
    db_session.commit()

    result = list_audit_log(db_session, None, None)

    assert result.entries[0].target_label is None


def test_list_audit_log_echoes_the_requested_date_range(db_session):
    result = list_audit_log(db_session, date(2026, 1, 1), date(2026, 2, 1))

    assert result.start_date == "2026-01-01"
    assert result.end_date == "2026-02-01"


# --- generate_audit_log_pdf ---


def test_generate_audit_log_pdf_returns_pdf_bytes():
    entries = [
        AdminAuditLogEntry(
            id=str(uuid.uuid4()),
            admin_id=str(uuid.uuid4()),
            admin_name="Admin Alice",
            action="member_suspended",
            target_type="member",
            target_id=str(uuid.uuid4()),
            target_label="Regular Bob",
            reason="Repeated no-shows.",
            created_at="2026-07-29T00:00:00+00:00",
        )
    ]

    pdf_bytes = generate_audit_log_pdf(entries)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 0


def test_generate_audit_log_pdf_handles_an_empty_list():
    pdf_bytes = generate_audit_log_pdf([])

    assert pdf_bytes.startswith(b"%PDF")


# --- route wiring ---


def test_admin_audit_log_routes_are_wired_into_the_app():
    from fastapi.routing import APIRoute

    expected = {
        ("/api/admin/audit-log", "GET"),
        ("/api/admin/audit-log/export", "GET"),
    }
    found = set()
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods:
                if method == "GET":
                    found.add((route.path, method))

    assert expected.issubset(found)
