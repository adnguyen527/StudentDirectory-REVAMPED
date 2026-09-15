"""How a filtered list is spread across centers -- the bar chart above a list page.

⚠️ **This reads the list's own collection, deliberately.** `/api/centers/metrics` also
counts students per center, but off `dwp_reports` and over a date range, which answers a
different question: what happened at a center in a period. A bar sitting directly above a
paged table has to answer "how do *these rows* divide up", so it counts the same documents
the table does, through the same criteria -- see `Student.criteria`. Two counts of the same
thing that disagree on screen are worse than one count that is only approximately what you
wanted.

**Headcount, never sessions-weighted**, although `centers[]` carries `{name, sessions}` on
both collections and the sum is right there. That count is all-time, so a sessions-weighted
bar above a table filtered by `?last_session_from=` would show all-time work under a
date-scoped list -- the trap models/center.py opens with. The question this chart answers
is "how many of these people are at each center", and that is a headcount.
"""

from models.filters import CENTER_FIELD, center_criteria


def by_center(collection, criteria, centers=None, key=CENTER_FIELD, path='$centers'):
    """{total, counted, no_center, distribution: [{center, count}]} over `criteria`.

    `key` and `path` default to the `[{name, sessions}]` shape `students` and `instructors`
    share; `dwp_reports` carries bare strings and would need ('centers', '$centers').

    **`total` and `counted` are different numbers and both are wanted.** `total` is the rows
    the list would show; `counted` is the sum of the bars. On students they are equal --
    every student belongs to exactly one center -- but on instructors `counted` is larger,
    because 11 of 103 work at two or more and appear under each. One person, two bars, and
    the page has to say so rather than look like a rounding error.

    `center` rather than `name` for the label, so a chart component drawing either
    collection cannot confuse it with a student's or an instructor's own name.
    """
    pipeline = [
        {'$match': criteria},
        # preserveNullAndEmptyArrays keeps the rows with no center at all: for `centers: []`
        # the stage drops the field rather than the document, so they arrive below under an
        # `_id` of None. That is one pipeline instead of a second round trip counting them
        # with $size/$exists, and mongomock implements it the same way the real server does.
        {'$unwind': {'path': path, 'preserveNullAndEmptyArrays': True}},
    ]

    narrowed = center_criteria(centers, key)
    if narrowed:
        # ⚠️ The SAME criterion a second time, and it is not redundant -- do not delete it.
        # The match above selects a *document* if any of its centers matches; $unwind then
        # emits *every* center on that document. Without this stage, filtering to one center
        # still returns a bar for the other centers of anyone who works at several -- centers
        # the caller explicitly excluded, with counts nobody asked for.
        pipeline.append({'$match': narrowed})

    pipeline.append({'$group': {'_id': f'${key}', 'count': {'$sum': 1}}})

    # No $sort stage: a None _id mixed with strings is the one ordering mongomock and the
    # real server could disagree on, and there are only ever a handful of centers. Sorting
    # here also makes the choice visible -- by NAME, not by count, so the bars hold position
    # as filters are ticked. /api/centers sorts its checkboxes for the same reason.
    no_center = 0
    rows = []
    for row in collection.aggregate(pipeline):
        if row['_id'] is None:
            no_center = row['count']
            continue
        rows.append({'center': row['_id'], 'count': row['count']})
    rows.sort(key=lambda row: row['center'])

    return {
        'total': collection.count_documents(criteria),
        'counted': sum(row['count'] for row in rows),
        # Always present, even under a ?center= filter where it is necessarily 0 -- a row
        # with no center cannot satisfy the $in. A stable shape beats a conditional key.
        'no_center': no_center,
        'distribution': rows,
    }
