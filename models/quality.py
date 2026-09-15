"""What is missing or contradictory in `dwp_reports` right now -- the monitoring cards.

**Current state, not an import audit.** Every count here is a question about the collection
as it stands, which is what a manager can act on today: these reports need finishing, these
sessions never recorded an end time. What happened during a particular import -- which rows
a run skipped, when, from which file -- is a different question that this collection cannot
answer, because nothing records it. That needs the `import_runs` collection on the TODO.

The one check that looks like history and is not is `ambiguous_keys`. `import_reports.py`
reports ambiguous natural keys to the console and moves on, so the *event* is lost -- but
the *condition* is still sitting in the data, because the colliding documents are both
still there. Grouping on NATURAL_KEY finds them without any record of the import that let
them in.

**Counts only.** The moment this returns example documents it needs LIST_PROJECTION and an
audit of PRIVATE_FIELDS, because every one of these rows is about a named child. Linking a
card to the reports behind it is the reports list's job, through its own filters.
"""

from database import db
from models.dwp_report import NATURAL_KEY


# ⚠️ `{'field': None}` matches both a null and an absent field, but an EMPTY ARRAY is a
# third state and neither engine folds it in the same way: `$in: [None, []]` matches `[]`
# on the real server and does NOT on mongomock, which the offline tests run against. So the
# two states are spelled out as an $or, which both agree on. Do not "simplify" this to $in.
def _blank(field):
    return {'$or': [{field: None}, {field: []}]}


# The checks, in the order the cards read. Each is a criterion over `dwp_reports`; the key
# is the contract, and the wording belongs to the frontend -- unlike /api/centers, whose
# names are data that changes under the UI, a new check here is new code either way and
# needs a card and an explanation written for it.
#
# Measured against the live collection (29,382 reports) when this was written, so the
# figures below say which of these are real today and which are tripwires reading zero:
CHECKS = {
    # 5,945. Much the largest, and not obviously a fault -- a session can be spent on
    # schoolwork -- but it is the reason a topic-based chart sees fewer sessions than the
    # session count, so it is worth a number rather than a surprise.
    'no_topics': _blank('topics'),
    # 1,068, and exactly the unfinalized set today: the source leaves pages blank until a
    # report is finalized. Kept as its own check because they answer different questions
    # and nothing guarantees they keep coinciding.
    'missing_pages': {'pages_completed': None},
    # 217. The source writes the literal string 'None'; parse_session nulls it on the way
    # in, so these are sessions that genuinely cannot be given a duration.
    'missing_session_end': {'session_end': None},
    # 73 unstaffed sessions -- real, and they still count as sessions.
    'no_instructor': _blank('instructors'),
    # 1,068. The actionable one: reports a manager can still chase.
    'unfinalized': {'finalized': {'$ne': True}},
    # Both 0 today, and tripwires rather than findings. They matter more than their current
    # value: every trend chart buckets on `date`, so a null one would drop out of every
    # chart silently rather than appear as a gap, and `session_start` is a quarter of the
    # natural key an import identifies a row by.
    'missing_date': {'date': None},
    'missing_session_start': {'session_start': None},
}


def _collection():
    return db.get_db()['dwp_reports']


# The ambiguous-key branch, kept apart because it is the one that is not a count.
_AMBIGUOUS = [
    {'$group': {'_id': {field: f'${field}' for field in NATURAL_KEY},
                'documents': {'$sum': 1}}},
    {'$match': {'documents': {'$gt': 1}}},
]


def summary(criteria=None):
    """{total, checks: [{key, count}], ambiguous_keys: [...]} over `criteria`.

    `criteria` is the same center and date filtering the reports list takes, so a manager
    can scope this to their own centers. It never carries an `$or` of its own, which is
    what lets each check merge its own in.

    **One `$facet`, where Center.summary runs its three queries separately.** Measured
    against the live cluster: nine `count_documents` round trips came to ~870ms and this
    comes to ~500ms, because the cost here is eight network round trips rather than the
    server's work -- each individual count is 60-110ms, most of it latency. That also
    makes this the shape that holds up when the database is further away: separate trips
    multiply the round-trip time by nine, and one does not.

    The trade-off, so nobody has to rediscover it: a `$facet` branch cannot use an index,
    so each check scans. The scoping `$match` runs **before** the facet and does use one,
    which is what keeps a center- or date-narrowed request cheap -- the branches then run
    over whatever that left. Center.summary avoided `$facet` for an unrelated reason
    (`$reduce`/`$setUnion`, which mongomock lacks); `$facet` itself it implements.

    The checks come back as a list rather than an object, as `Attendance.period_summary`
    returns its months: JSON object key order is not something a client should have to
    trust, and the cards are rendered in order.
    """
    facets = {key: [{'$match': check}, {'$count': 'n'}] for key, check in CHECKS.items()}
    facets['__total'] = [{'$count': 'n'}]
    facets['__ambiguous'] = _AMBIGUOUS

    rolled = next(iter(_collection().aggregate([
        {'$match': dict(criteria or {})},
        {'$facet': facets},
    ])), {})

    def count(key):
        # An empty branch means nothing matched: $count emits no document rather than a 0.
        branch = rolled.get(key) or []
        return branch[0]['n'] if branch else 0

    return {
        'total': count('__total'),
        'checks': [{'key': key, 'count': count(key)} for key in CHECKS],
        'ambiguous_keys': _named(rolled.get('__ambiguous') or []),
    }


def _named(grouped):
    """Group rows flattened to the key fields they are about, in a settled order."""
    found = [{**row['_id'], 'documents': row['documents']} for row in grouped]
    # Sorted so the list holds still between requests; a group has no order.
    found.sort(key=lambda row: (str(row.get('date')), str(row.get('student_name'))))
    return found


def ambiguous_keys(criteria=None):
    """The natural keys more than one stored document shares -- four in the live data.

    These are the rows an import can no longer update: `_upsert` refuses to guess which of
    them a source row means, names the key and skips it. Returned in full rather than
    counted because there are four, and a manager chasing one needs to know *which*
    student-day it is -- these are the fields that identify it and nothing more.

    Grouped on NATURAL_KEY itself, imported rather than spelled again here, so this cannot
    drift from the key the importer actually writes on.

    `summary` folds this into its own `$facet` rather than calling it, to save a round
    trip; this stays as the way to ask the question on its own.
    """
    return _named(_collection().aggregate([
        {'$match': dict(criteria or {})},
        *_AMBIGUOUS,
    ]))
