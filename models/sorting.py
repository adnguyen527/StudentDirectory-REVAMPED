"""Turning a column name into an order a paged cursor can be trusted with.

Kept beside models/filters.py for the same reason: all three list models need it and none
of them should have to import another to get it.
"""

from pymongo import ASCENDING, DESCENDING


def build_order(key, direction, sortable, tie_break, default):
    """[(field, direction), ...] for the named column, or `default` when none is named.

    `sortable` maps the URL's column key to `(document field, default direction)`. The
    default direction is per column and is part of the declaration because it differs by
    what the column means: a name sorts A-Z first, while every count and date sorts
    largest-first, which is the end anyone actually asks about -- most sessions, most
    unfinalized, most recent.

    **The order is always total.** `tie_break` -- the collection's unique key -- is
    appended to every column sort, because skip/limit over a partial order can repeat a
    document on one page and drop it from the next, and the count columns tie constantly:
    670 of 771 topics share a session count with another topic, and 822 of 893 students
    have between 1 and 7 topics on plan.

    The tie-break is ascending whichever way the column runs, rather than following it.
    That looks inconsistent and is deliberate: the stored indexes are
    (student_name ASC, student_key ASC) and (sessions DESC, topic_id ASC), so an ascending
    tie-break is what lets the default orders stay index scans. Making it follow the
    column would take topics' own resting order off its index and into a blocking sort.
    """
    if not key:
        return default

    field, fallback = sortable[key]
    way = fallback if direction is None else (ASCENDING if direction == 'asc' else DESCENDING)

    # A sort on the unique key is already total; appending it to itself is not wrong, but
    # pymongo would send the same field twice.
    if field == tie_break:
        return [(field, way)]
    return [(field, way), (tie_break, ASCENDING)]
