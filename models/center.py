"""Center-wide totals, computed per request from `dwp_reports`.

There is no `centers` collection and deliberately so. The four other aggregates here are
built because they answer a question about one document -- a student's history, a topic's
reach -- that no query can reach quickly. A center total is the opposite shape: five
scalars over an indexed date range, measured at ~120ms for the largest center across nine
months of the live data. A built collection would add a fifth thing to rebuild, and a
fifth thing to be stale, to save a tenth of a second.

⚠️ **Why this reads `dwp_reports` and not `instructors`.** Co-taught sessions credit each
instructor the full page count -- pages are copied, not split -- so summing
`total_pages_completed` across a center's instructors comes to 168,623 against the 153,360
pages actually recorded. 2,563 of 29,382 sessions have more than one instructor. The same
trap sits on `students`, differently: those totals are all-time, so they cannot answer a
question about a period. Sessions are the only place both are right.
"""

from database import db
from models.dwp_report import CENTER_FIELD
from models.filters import center_criteria


# CENTER_FIELD comes from the report model rather than being spelled again here:
# `dwp_reports.centers` is a bare list of strings where students and instructors carry
# `[{name, sessions}]`, and a second spelling of that would be a second thing to change.

# The shape of an empty answer, so a selection matching nothing reads as zeroes rather
# than as nulls the frontend has to special-case. A center with no sessions is a correct
# answer to the question, not a missing one.
EMPTY = {
    'sessions': 0,
    'students': 0,
    'instructors': 0,
    'pages_completed': 0,
    'unfinalized': 0,
    'days': 0,
    'first_session': None,
    'last_session': None,
}


class Center:
    """A center is a value on a session, not a document of its own."""

    @staticmethod
    def _collection():
        return db.get_db()['dwp_reports']

    @staticmethod
    def criteria(centers=None, start=None, end=None):
        """The match every figure below shares.

        No centers means every center, which is what `center_criteria` already does for
        the list routes -- an absent filter and a filter on everything are the same query.
        """
        criteria = dict(center_criteria(centers, CENTER_FIELD))
        if start is not None or end is not None:
            bounds = {}
            if start is not None:
                bounds['$gte'] = start
            if end is not None:
                bounds['$lte'] = end
            criteria['date'] = bounds
        return criteria

    @staticmethod
    def summary(centers=None, start=None, end=None):
        """Sessions, students, instructors, pages and days across these centers.

        Three round trips rather than one `$facet`. The counts need three different
        notions of distinct -- a student is a *pair* of fields, an instructor is an
        element of an array, a day is a scalar -- and expressing all three in one pipeline
        needs `$reduce`/`$setUnion` over an `$addToSet` of arrays, which mongomock does not
        implement and which no reader would thank us for. Each of these is an indexed
        match over the same criteria.

        Both date bounds are inclusive and optional. `date` is stored at midnight, so an
        end of 2025-06-30 includes everything on the 30th -- the same contract
        `Attendance.period_summary` states.
        """
        collection = Center._collection()
        criteria = Center.criteria(centers, start, end)

        totals = dict(EMPTY)

        rolled = list(collection.aggregate([
            {'$match': criteria},
            {'$group': {
                '_id': None,
                # One row is one session. Days are counted separately below, because a
                # student-day can carry more than one session and the two numbers differ.
                'sessions': {'$sum': 1},
                'pages_completed': {'$sum': '$pages_completed'},
                # Unfinalized is the actionable figure on this page: the reports a manager
                # can still chase today. A missing `finalized` counts as not finalized.
                'unfinalized': {'$sum': {'$cond': [{'$eq': ['$finalized', True]}, 0, 1]}},
                'first_session': {'$min': '$date'},
                'last_session': {'$max': '$date'},
            }},
        ]))

        if not rolled:
            # No sessions at all -- every figure below would be zero anyway, and the two
            # further queries would each cost a round trip to learn that.
            return totals

        rolled[0].pop('_id', None)
        totals.update(rolled[0])
        # $sum over a field absent from every matched document answers 0, but a collection
        # holding nulls answers None on some drivers. Neither should reach a stat tile.
        totals['pages_completed'] = totals['pages_completed'] or 0

        # ⚠️ Both fields, never account_id alone: an account is a household, and 191 of
        # them carry two to five siblings. Grouping by the account would undercount
        # students by every sibling after the first.
        counted = list(collection.aggregate([
            {'$match': criteria},
            {'$group': {'_id': {
                'account_id': '$account_id',
                'student_name': '$student_name',
            }}},
            {'$count': 'students'},
        ]))
        totals['students'] = counted[0]['students'] if counted else 0

        # `distinct` flattens the array and dedupes, so an instructor who worked at two of
        # the selected centers counts once -- 11 of 103 do. The same call on `date` gives
        # days attended, which is not the session count above.
        totals['instructors'] = len(collection.distinct('instructors', criteria))
        totals['days'] = len(collection.distinct('date', criteria))

        return totals
