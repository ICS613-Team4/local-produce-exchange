# Admin audit log: a chronological view of admin moderation actions (US-35),
# and a downloadable PDF of the same. Like the other admin routers, the code
# is split into pure core functions (list_audit_log, generate_audit_log_pdf),
# which the unit tests call directly, and thin HTTP routes that wire up
# require_admin and get_db_session.

import logging
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db_session
from app.dependencies import require_admin
from app.models.admin_audit_log import AdminAuditLog
from app.models.listing import Listing
from app.models.member import Member
from app.schemas.admin_audit_log import AdminAuditLogEntry, AdminAuditLogResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def list_audit_log(
    session: Session,
    start_date: Optional[date],
    end_date: Optional[date],
    limit: Optional[int] = None,
) -> AdminAuditLogResponse:
    # Same date-range convention as admin_reports.py: a range is inclusive of
    # both endpoints, so the end date's bound reaches the end of that
    # calendar day.
    start_at = None
    if start_date is not None:
        start_at = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    end_at = None
    if end_date is not None:
        end_at = datetime.combine(end_date, time.max, tzinfo=timezone.utc)

    statement = select(AdminAuditLog).order_by(
        AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()
    )
    if start_at is not None:
        statement = statement.where(AdminAuditLog.created_at >= start_at)
    if end_at is not None:
        statement = statement.where(AdminAuditLog.created_at <= end_at)
    if limit is not None:
        statement = statement.limit(limit)

    try:
        rows = session.scalars(statement).all()
    except Exception as error:
        logger.error("Loading the admin audit log failed: %s", error)
        raise HTTPException(status_code=503, detail="Could not load the audit log right now.")

    # target_id points at a different table depending on target_type, so a
    # single join cannot resolve every row's label. Two batched lookups
    # (member ids, listing ids) instead of one query per row.
    member_target_ids = set()
    listing_target_ids = set()
    admin_ids = set()
    for row in rows:
        if row.target_type == "member":
            member_target_ids.add(row.target_id)
        elif row.target_type == "listing":
            listing_target_ids.add(row.target_id)
        if row.admin_id is not None:
            admin_ids.add(row.admin_id)

    member_names: dict = {}
    if member_target_ids or admin_ids:
        try:
            for member_id, name in session.execute(
                select(Member.id, Member.name).where(
                    Member.id.in_(member_target_ids | admin_ids)
                )
            ).all():
                member_names[member_id] = name
        except Exception as error:
            logger.error("Loading audit log member labels failed: %s", error)
            raise HTTPException(status_code=503, detail="Could not load the audit log right now.")

    listing_titles: dict = {}
    if listing_target_ids:
        try:
            for listing_id, title in session.execute(
                select(Listing.id, Listing.title).where(Listing.id.in_(listing_target_ids))
            ).all():
                listing_titles[listing_id] = title
        except Exception as error:
            logger.error("Loading audit log listing labels failed: %s", error)
            raise HTTPException(status_code=503, detail="Could not load the audit log right now.")

    entries = []
    for row in rows:
        admin_id_text = None
        admin_name = None
        if row.admin_id is not None:
            admin_id_text = str(row.admin_id)
            admin_name = member_names.get(row.admin_id)

        target_label = None
        if row.target_type == "member":
            target_label = member_names.get(row.target_id)
        elif row.target_type == "listing":
            target_label = listing_titles.get(row.target_id)

        entries.append(
            AdminAuditLogEntry(
                id=str(row.id),
                admin_id=admin_id_text,
                admin_name=admin_name,
                action=row.action,
                target_type=row.target_type,
                target_id=str(row.target_id),
                target_label=target_label,
                reason=row.reason,
                created_at=row.created_at.isoformat(),
            )
        )

    start_date_text = start_date.isoformat() if start_date is not None else None
    end_date_text = end_date.isoformat() if end_date is not None else None

    return AdminAuditLogResponse(
        entries=entries,
        total_count=len(entries),
        start_date=start_date_text,
        end_date=end_date_text,
    )


# fpdf2's built-in "Helvetica" is a PDF core font limited to strict Latin-1
# (ISO-8859-1): any codepoint above 0xFF raises FPDFUnicodeEncodingException
# and aborts the whole export. Admin-entered free text (suspension reasons,
# report notes) routinely picks up "smart" typography from autocorrect -
# curly quotes, em/en dashes, an ellipsis - none of which are in that range.
# DejaVu Sans is embedded instead so any text renders correctly. fpdf2 does
# not bundle a Unicode-capable font itself; the .ttf files live in
# app/fonts/ (Bitstream Vera license, see app/fonts/DEJAVU-LICENSE.txt).
_FONTS_DIR = Path(__file__).resolve().parent.parent / "fonts"
_PDF_FONT_FAMILY = "DejaVuSans"


def _register_pdf_font(pdf: FPDF) -> None:
    pdf.add_font(_PDF_FONT_FAMILY, style="", fname=str(_FONTS_DIR / "DejaVuSans.ttf"))
    pdf.add_font(_PDF_FONT_FAMILY, style="B", fname=str(_FONTS_DIR / "DejaVuSans-Bold.ttf"))


def _format_pdf_timestamp(created_at: str) -> str:
    # The full ISO string (e.g. "2026-07-29T00:00:00+00:00") is precise but
    # wider than DejaVu Sans renders comfortably in the Timestamp column at
    # this font size - it was clipping against the cell border. Every
    # created_at here is already UTC (see AdminAuditLog.created_at), so this
    # is just a shorter, still-unambiguous display format, not a timezone
    # conversion. Falls back to the raw string if it cannot be parsed, so a
    # bad value stays visible for debugging rather than disappearing.
    try:
        parsed = datetime.fromisoformat(created_at)
    except ValueError:
        return created_at
    return parsed.strftime("%Y-%m-%d %H:%M UTC")


def generate_audit_log_pdf(entries: list[AdminAuditLogEntry]) -> bytes:
    # Pure: no DB access, so this is unit-testable with a hand-built list.
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    _register_pdf_font(pdf)
    pdf.add_page()
    pdf.set_font(_PDF_FONT_FAMILY, size=9)

    columns = [
        ("Timestamp", 45),
        ("Admin", 40),
        ("Action", 45),
        ("Target", 60),
        ("Reason", 80),
    ]

    pdf.set_font(_PDF_FONT_FAMILY, style="B", size=9)
    for heading, width in columns:
        pdf.cell(width, 8, heading, border=1)
    pdf.ln()

    pdf.set_font(_PDF_FONT_FAMILY, size=9)
    for entry in entries:
        admin_text = entry.admin_name or "(unknown)"
        target_text = entry.target_label or (entry.target_type + " " + entry.target_id[:8])
        reason_text = entry.reason or ""
        pdf.cell(columns[0][1], 8, _format_pdf_timestamp(entry.created_at), border=1)
        pdf.cell(columns[1][1], 8, admin_text, border=1)
        pdf.cell(columns[2][1], 8, entry.action, border=1)
        pdf.cell(columns[3][1], 8, target_text, border=1)
        pdf.cell(columns[4][1], 8, reason_text, border=1)
        pdf.ln()

    return bytes(pdf.output())


@router.get("/admin/audit-log")
def list_audit_log_endpoint(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    limit: Optional[int] = Query(default=None),
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> AdminAuditLogResponse:
    return list_audit_log(session, start_date, end_date, limit=limit)


@router.get("/admin/audit-log/export")
def export_audit_log_pdf_endpoint(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    current_member: Member = Depends(require_admin),
    session: Session = Depends(get_db_session),
) -> Response:
    response_data = list_audit_log(session, start_date, end_date)
    pdf_bytes = generate_audit_log_pdf(response_data.entries)

    filename = "audit-log-" + (start_date.isoformat() if start_date else "all")
    filename += "-" + (end_date.isoformat() if end_date else "all") + ".pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="' + filename + '"'},
    )
