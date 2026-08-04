# One numbered-page pattern for every list endpoint that pages (US-33).
#
# Three pieces live here, so no route invents its own version:
#   1. The two page size numbers, shared by the backend and mirrored by the
#      frontend's own constant.
#   2. The Page envelope every paged endpoint returns: the window of rows, the
#      total that matched the same filters, and the page numbers used to build
#      it, so the caller can draw "Showing 1-12 of 40" without a second call.
#   3. The two query helpers that turn a filtered statement into a COUNT and a
#      windowed SELECT.
#
# This is offset paging over the ordering the routes already had. Every paged
# statement orders by a real sort column plus the id as a tiebreaker, so the
# order is total: no two rows can swap places between two requests, which is
# what makes OFFSET/LIMIT safe to page with.
#
# A page past the end is NOT clamped here on purpose. The route answers
# honestly with an empty items list and the true total, so the caller can see
# that the page it asked for is out of range and fall back to the last real
# page. Clamping lives in the frontend, which owns the URL the member sees.

from typing import Annotated, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import func, select

# Every paged page on the site shows 12 rows unless the caller says otherwise.
# The frontend has its own copy of this number in
# frontend/src/utils/pagination.ts; keep the two in step.
DEFAULT_PAGE_SIZE = 12

# The ceiling on page_size. It caps how much work one request can ask for, so a
# hand-edited URL cannot ask for the whole table at once. A larger value is
# rejected with a 422 by the annotation below, before the route runs.
MAX_PAGE_SIZE = 100

# The two query-parameter types the paged routes share. Pydantic and FastAPI
# validate them, so page=0 or page_size=101 is a 422 from the framework and the
# route body only ever sees values inside the bounds.
PageNumber = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)]

ItemType = TypeVar("ItemType")


class Page(BaseModel, Generic[ItemType]):
    # The paged envelope. items is this page's rows, total is how many rows
    # matched the same filters across every page, and page and page_size are
    # the window that produced items, echoed back so the caller never has to
    # guess which page it is looking at.
    items: list[ItemType]
    total: int
    page: int
    page_size: int


def count_matching_rows(session, statement):
    # How many rows the statement matches, ignoring any ordering. The statement
    # is wrapped as a subquery so the COUNT runs against exactly the filters the
    # route built, with no chance of the two drifting apart. The ORDER BY is
    # dropped first because a count has nothing to sort and Postgres rejects an
    # ordered subquery column that is not selected.
    #
    # Pass the statement BEFORE the page window is applied; counting a windowed
    # statement would only ever count one page.
    count_statement = select(func.count()).select_from(statement.order_by(None).subquery())
    total = session.scalar(count_statement)
    if total is None:
        return 0
    return int(total)


def apply_page_window(statement, page, page_size):
    # Add the OFFSET/LIMIT for one page to an already-ordered statement. page is
    # 1-based, so page 1 starts at offset 0. A page past the end produces no
    # rows, which is the honest empty window described at the top of this file.
    return statement.limit(page_size).offset((page - 1) * page_size)
