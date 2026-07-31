# Tests for the admin dashboard snapshot (US-38).
# Run from the project root with: npm run test:backend

from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import Range

from app.audit_log import record_audit_log_entry
from app.main import app
from app.models.claim import Claim
from app.models.listing import Listing
from app.models.member import Member
from app.models.member_report import MemberReport
from app.routers.admin_dashboard import build_admin_dashboard_snapshot, get_admin_dashboard_endpoint


def insert_member(session, name="Alice", email="alice@example.com", status="active", role="member"):
    member = Member(name=name, email=email, password_hash="not-a-real-hash", status=status, role=role)
    session.add(member)
    session.commit()
    return member


def insert_listing(session, owner, status="active"):
    pickup_window = Range(
        datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
        datetime(2026, 7, 1, 11, 0, tzinfo=timezone.utc),
        bounds="[)",
    )
    listing = Listing(
        owner_id=owner.id,
        title="Fresh Tomatoes",
        description="Ripe red tomatoes.",
        category="Vegetables",
        dietary_tags=[],
        allergen_tags=[],
        total_quantity=5,
        remaining_quantity=5,
        pickup_window=pickup_window,
        status=status,
    )
    session.add(listing)
    session.commit()
    return listing


def insert_claim(session, listing, claimant, status="requested"):
    claim = Claim(
        listing_id=listing.id,
        claimant_id=claimant.id,
        requested_quantity=1,
        status=status,
        requested_at=datetime.now(timezone.utc),
    )
    session.add(claim)
    session.commit()
    return claim


def insert_member_report(session, reporter, target, status="open"):
    report = MemberReport(
        reporter_id=reporter.id,
        target_member_id=target.id,
        category="harassment",
        status=status,
    )
    session.add(report)
    session.commit()
    return report


def test_snapshot_counts_active_listings(db_session):
    owner = insert_member(db_session)
    insert_listing(db_session, owner, status="active")
    insert_listing(db_session, owner, status="deactivated")

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert snapshot.active_listings == 1


def test_snapshot_counts_open_requests(db_session):
    owner = insert_member(db_session, name="Owner", email="owner@example.com")
    claimant = insert_member(db_session, name="Claimant", email="claimant@example.com")
    listing = insert_listing(db_session, owner)
    insert_claim(db_session, listing, claimant, status="requested")
    insert_claim(db_session, listing, claimant, status="completed")

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert snapshot.open_requests == 1


def test_snapshot_counts_currently_suspended_members(db_session):
    insert_member(db_session, name="Active Alice", email="alice@example.com", status="active")
    insert_member(db_session, name="Suspended Sam", email="sam@example.com", status="suspended")

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert snapshot.members_currently_suspended == 1


def test_snapshot_includes_open_member_reports(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    insert_member_report(db_session, reporter, target, status="open")
    insert_member_report(db_session, insert_member(db_session, name="Reporter Two", email="reporter2@example.com"), target, status="resolved")

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert snapshot.open_member_reports_count == 1
    assert len(snapshot.recent_member_reports) == 1
    assert snapshot.recent_member_reports[0].status == "open"
    assert admin.role == "admin"  # sanity: admin insert didn't affect report counts


def test_snapshot_limits_recent_member_reports_to_ten(db_session):
    target = insert_member(db_session, name="Target", email="target@example.com")
    for index in range(12):
        reporter = insert_member(db_session, name=f"Reporter {index}", email=f"reporter{index}@example.com")
        insert_member_report(db_session, reporter, target, status="open")

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert snapshot.open_member_reports_count == 12
    assert len(snapshot.recent_member_reports) == 10


def test_snapshot_includes_recent_admin_actions(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    target = insert_member(db_session, name="Target", email="target@example.com")
    record_audit_log_entry(db_session, admin.id, "member_suspended", "member", target.id)
    db_session.commit()

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert len(snapshot.recent_admin_actions) == 1
    assert snapshot.recent_admin_actions[0].action == "member_suspended"


def test_snapshot_limits_recent_admin_actions_to_five(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    target = insert_member(db_session, name="Target", email="target@example.com")
    for _ in range(7):
        record_audit_log_entry(db_session, admin.id, "member_suspended", "member", target.id)
    db_session.commit()

    snapshot = build_admin_dashboard_snapshot(db_session)

    assert len(snapshot.recent_admin_actions) == 5


# --- route wiring ---


def test_admin_dashboard_route_is_wired_into_the_app():
    from fastapi.routing import APIRoute

    found = False
    for route in app.routes:
        if isinstance(route, APIRoute):
            if route.path == "/api/admin/dashboard" and "GET" in route.methods:
                found = True
    assert found


def test_admin_dashboard_endpoint_delegates_to_core(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    insert_listing(db_session, admin, status="active")

    result = get_admin_dashboard_endpoint(current_member=admin, session=db_session)

    assert result.active_listings == 1
