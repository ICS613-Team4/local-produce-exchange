# Tests for reporting a member and the admin side of reviewing those reports
# (US-37).
# Run from the project root with: npm run test:backend
#
# Like the other admin-adjacent test files, the core tests call
# file_member_report(), list_member_reports(), and
# resolve_member_report_as_admin() directly with real DB sessions.

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.member import Member
from app.models.member_report import MemberReport
from app.routers.member_report import (
    file_member_report,
    file_member_report_endpoint,
    list_member_reports,
    resolve_member_report_as_admin,
    resolve_member_report_endpoint,
)
from app.schemas.member_report import ReportMemberRequest, ResolveMemberReportRequest


def insert_member(session, name="Reporter", email="reporter@example.com", role="member"):
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


def insert_open_report(session, reporter, target, category="harassment"):
    report = MemberReport(
        reporter_id=reporter.id,
        target_member_id=target.id,
        category=category,
        status="open",
    )
    session.add(report)
    session.commit()
    return report


# --- core: file_member_report ---


def test_file_member_report_happy_path(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")

    result = file_member_report(reporter, target.id, "harassment", "Was rude.", db_session)

    assert result.target_member_id == str(target.id)
    assert result.category == "harassment"
    assert result.detail == "Was rude."
    assert result.status == "open"


def test_file_member_report_rejects_unknown_category(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")

    with pytest.raises(HTTPException) as raised_error:
        file_member_report(reporter, target.id, "banana", None, db_session)

    assert raised_error.value.status_code == 422


def test_file_member_report_rejects_unknown_target(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")

    with pytest.raises(HTTPException) as raised_error:
        file_member_report(reporter, uuid.uuid4(), "harassment", None, db_session)

    assert raised_error.value.status_code == 404


def test_file_member_report_rejects_self_report(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")

    with pytest.raises(HTTPException) as raised_error:
        file_member_report(reporter, reporter.id, "harassment", None, db_session)

    assert raised_error.value.status_code == 422


def test_file_member_report_rejects_a_second_open_report_on_the_same_target(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    insert_open_report(db_session, reporter, target)

    with pytest.raises(HTTPException) as raised_error:
        file_member_report(reporter, target.id, "no_show", None, db_session)

    assert raised_error.value.status_code == 409


def test_file_member_report_allows_a_new_report_once_the_earlier_one_is_resolved(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    earlier = insert_open_report(db_session, reporter, target)
    resolve_member_report_as_admin(admin, earlier.id, "handled", db_session)

    result = file_member_report(reporter, target.id, "no_show", None, db_session)

    assert result.status == "open"


def test_database_rejects_a_second_open_report_inserted_directly(db_session):
    """uq_member_report_one_open fires on a raw insert, the backstop behind
    file_member_report's own pre-check."""
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    insert_open_report(db_session, reporter, target)

    with pytest.raises(IntegrityError):
        db_session.add(
            MemberReport(
                reporter_id=reporter.id,
                target_member_id=target.id,
                category="other",
                status="open",
            )
        )
        db_session.commit()
    db_session.rollback()


# --- core: list_member_reports ---


def test_list_member_reports_filters_by_status(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    open_report = insert_open_report(db_session, reporter, target)
    resolved_report = insert_open_report(
        db_session,
        insert_member(db_session, name="Reporter Two", email="reporter2@example.com"),
        target,
    )
    resolve_member_report_as_admin(admin, resolved_report.id, None, db_session)

    open_results = list_member_reports(db_session, status="open")
    resolved_results = list_member_reports(db_session, status="resolved")

    assert [r.id for r in open_results] == [str(open_report.id)]
    assert [r.id for r in resolved_results] == [str(resolved_report.id)]


def test_list_member_reports_includes_reporter_and_target_names(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    insert_open_report(db_session, reporter, target)

    results = list_member_reports(db_session, status="open")

    assert results[0].reporter_name == "Reporter"
    assert results[0].target_name == "Target"


def test_list_member_reports_respects_limit(db_session):
    target = insert_member(db_session, name="Target", email="target@example.com")
    for index in range(3):
        reporter = insert_member(db_session, name=f"Reporter {index}", email=f"reporter{index}@example.com")
        insert_open_report(db_session, reporter, target)

    results = list_member_reports(db_session, status="open", limit=2)

    assert len(results) == 2


# --- core: resolve_member_report_as_admin ---


def test_resolve_member_report_happy_path(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    report = insert_open_report(db_session, reporter, target)

    resolve_member_report_as_admin(admin, report.id, "Talked to the member.", db_session)

    db_session.refresh(report)
    assert report.status == "resolved"
    assert report.resolved_by == admin.id
    assert report.resolution_note == "Talked to the member."
    assert report.resolved_at is not None


def test_resolve_member_report_writes_an_audit_log_entry(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    report = insert_open_report(db_session, reporter, target)

    resolve_member_report_as_admin(admin, report.id, "Talked to the member.", db_session)

    entry = db_session.scalars(
        select(AdminAuditLog).where(AdminAuditLog.target_id == report.id)
    ).first()
    assert entry is not None
    assert entry.admin_id == admin.id
    assert entry.action == "member_report_resolved"
    assert entry.target_type == "member_report"
    assert entry.reason == "Talked to the member."


def test_resolve_member_report_rejects_unknown_id(db_session):
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")

    with pytest.raises(HTTPException) as raised_error:
        resolve_member_report_as_admin(admin, uuid.uuid4(), None, db_session)

    assert raised_error.value.status_code == 404


def test_resolve_member_report_rejects_already_resolved(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    report = insert_open_report(db_session, reporter, target)
    resolve_member_report_as_admin(admin, report.id, None, db_session)

    with pytest.raises(HTTPException) as raised_error:
        resolve_member_report_as_admin(admin, report.id, None, db_session)

    assert raised_error.value.status_code == 409


# --- route wiring ---


def test_member_report_routes_are_wired_into_the_app():
    from fastapi.routing import APIRoute

    expected = {
        ("/api/members/{member_id}/reports", "POST"),
        ("/api/admin/member-reports", "GET"),
        ("/api/admin/member-reports/{report_id}/resolve", "POST"),
    }
    found = set()
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods:
                if method in ("GET", "POST"):
                    found.add((route.path, method))

    assert expected.issubset(found)


# --- route passthrough ---


def test_file_member_report_endpoint_delegates_to_core(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")

    result = file_member_report_endpoint(
        member_id=target.id,
        payload=ReportMemberRequest(category="harassment", detail=None),
        current_member=reporter,
        session=db_session,
    )

    assert result.status == "open"


def test_file_member_report_endpoint_rejects_suspended_member(db_session):
    target = insert_member(db_session, name="Target", email="target@example.com")
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    reporter.status = "suspended"
    db_session.commit()

    with pytest.raises(HTTPException) as raised_error:
        file_member_report_endpoint(
            member_id=target.id,
            payload=ReportMemberRequest(category="harassment", detail=None),
            current_member=reporter,
            session=db_session,
        )

    assert raised_error.value.status_code == 403


def test_resolve_member_report_endpoint_delegates_to_core(db_session):
    reporter = insert_member(db_session, name="Reporter", email="reporter@example.com")
    target = insert_member(db_session, name="Target", email="target@example.com")
    admin = insert_member(db_session, name="Admin", email="admin@example.com", role="admin")
    report = insert_open_report(db_session, reporter, target)

    resolve_member_report_endpoint(
        report_id=report.id,
        payload=ResolveMemberReportRequest(resolution_note="ok"),
        current_member=admin,
        session=db_session,
    )

    db_session.refresh(report)
    assert report.status == "resolved"
