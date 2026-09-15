"""Sessions over time, bucketed by day, week or month -- the query under three charts.

The report-volume chart, the Home activity trends and the instructor workload chart ask
the same question at different parameters: match `dwp_reports`, bucket by date, count what
happened in each bucket. Three routes, because each draws a different series and should not
have to explain the fields it ignores, but one query, because three copies of this
arithmetic would be three chances to count a co-taught session twice.

⚠️ **Off `dwp_reports`, never the built aggregates.** A session is counted once here.
Summing `instructors.total_pages_completed` over the same window comes to 168,623 pages
against the 153,360 actually recorded, because a co-taught session credits its pages to
each instructor in full; and `students.total_*` is all-time, so it cannot answer a period
at all. This is the rule models/center.py opens with, and it is why this module exists.

⚠️ **Bucket keys are built in the query, and the operator choice is not free.** mongomock --
which the offline tests run against -- implements `$dateToString` but NOT `$dateTrunc`,
`$isoWeek` or `$isoWeekYear`. So the ISO week is spelled `%G-W%V` through `$dateToString`,
which both engines support (`%G`, `%V` and `%u` have been documented specifiers since
MongoDB 3.6). Anyone "simplifying" this into `$dateTrunc` or `$isoWeek` will pass code
review and break every offline test.
"""

from datetime import datetime, timedelta

from database import db


DEFAULT_INTERVAL = 'day'

# The most buckets one response will build. `?interval=day&date_from=2000-01-01` is ~9,600,
# nearly all of them zeroes filled in below. That is the shape routes/pagination.py exists
# to close, so it is closed the same way -- except as a refusal rather than a cap, because
# a truncated time series reads as a real decline where a truncated page reads as a page.
#
# ⚠️ **It has to stay clear of the dataset's own full span at day granularity**, or the
# guard refuses a legitimate question instead of an absurd one. Measured against the live
# data (2024-08-09 to 2025-09-17): 405 daily buckets, which a limit of 400 refused -- the
# first version of this constant was wrong for exactly that reason. 750 is about two years
# of days, fourteen years of weeks and sixty years of months, and still refuses the case
# above by more than tenfold. Check this figure again if the data ever spans two years.
MAX_BUCKETS = 750

# Per interval: how the key is spelled, and how wide a window to answer with when the
# caller named no dates.
#
# ⚠️ All three formats are zero-padded and fixed width, so lexicographic order IS
# chronological order -- '2026-W05' < '2026-W10' < '2026-W53' < '2027-W01'. The buckets are
# matched to the axis by this key, so that property is load-bearing and invisible.
#
# `default_buckets` differs per interval on purpose. One flat "latest 30 days" would give a
# monthly chart two bars, which pushes the window arithmetic into the frontend as well --
# and then there are two anchors to keep in step. See resolve_range.
INTERVALS = {
    'day': {'format': '%Y-%m-%d', 'default_buckets': 30},
    'week': {'format': '%G-W%V', 'default_buckets': 12},
    'month': {'format': '%Y-%m', 'default_buckets': 12},
}

INTERVAL_NAMES = ', '.join(INTERVALS)

# What a bucket nobody attended reports. Zeroes rather than nulls, so a chart can plot the
# point rather than special-case it -- the same reasoning as Center.EMPTY.
EMPTY = {'sessions': 0, 'students': 0, 'pages_completed': 0, 'unfinalized': 0}


def _collection():
    return db.get_db()['dwp_reports']


def bucket_key(moment, interval):
    """The key `$dateToString` would produce for this datetime -- they must agree exactly.

    `isocalendar()` rather than `strftime('%G-W%V')`: Python supports those specifiers, but
    isocalendar() cannot be surprised by a platform's C library and says what it means. The
    ISO week-year is NOT the calendar year -- 2025-12-29 falls in 2026-W01 -- and the week
    is not the month over seven.
    """
    if interval == 'day':
        return moment.strftime('%Y-%m-%d')
    if interval == 'month':
        return moment.strftime('%Y-%m')
    year, week, _ = moment.isocalendar()
    return f'{year}-W{week:02d}'


def bucket_start(moment, interval):
    """The first day of the bucket holding `moment`, at midnight.

    A week starts MONDAY, because `%V` is ISO and Monday-based; any other choice would
    contradict the key the same bucket is matched by.
    """
    day = datetime(moment.year, moment.month, moment.day)
    if interval == 'day':
        return day
    if interval == 'month':
        return datetime(day.year, day.month, 1)
    return day - timedelta(days=day.weekday())


def shift(start, interval, buckets):
    """`start` moved `buckets` whole buckets forward, or backward when negative."""
    if interval == 'day':
        return start + timedelta(days=buckets)
    if interval == 'week':
        return start + timedelta(weeks=buckets)
    index = start.year * 12 + (start.month - 1) + buckets
    return datetime(index // 12, index % 12 + 1, 1)


def bucket_end(start, interval):
    """The bucket's LAST DAY, at midnight -- inclusive, not the following midnight.

    `range_criteria` already states the convention: dates are stored at midnight, so an
    `$lte` on a date covers that whole day. An exclusive end here would be the only date
    bound in the codebase that is not inclusive.
    """
    return shift(start, interval, 1) - timedelta(days=1)


def bucket_count(start, end, interval):
    """How many buckets `axis` would build, without building them -- for the cap."""
    first = bucket_start(start, interval)
    if interval == 'day':
        return (end - first).days + 1
    if interval == 'week':
        return (end - first).days // 7 + 1
    return (end.year - first.year) * 12 + (end.month - first.month) + 1


def axis(start, end, interval):
    """The ordered, gapless buckets covering [start, end] -- [{key, start, end, partial}].

    Pure: no database, so the calendar arithmetic is testable without a mock.

    **Driven by the requested range, not by the data.** That is the only way a month nobody
    attended appears as a zero rather than as a hole in the line -- an aggregation cannot
    return rows for dates that have none, and `$densify` is MongoDB 5.1+ and absent from
    mongomock.

    `partial` marks a bucket the range only covers part of. The range is used exactly as
    asked and never snapped outward to bucket boundaries: this chart sits above a table
    filtered by the same dates, and widening the window silently would count sessions that
    table excludes. So the edge bars are short, and `partial` is how the chart can say the
    window is short rather than the center quiet.
    """
    buckets = []
    cursor = bucket_start(start, interval)
    while cursor <= end:
        finish = bucket_end(cursor, interval)
        buckets.append({
            'key': bucket_key(cursor, interval),
            'start': cursor,
            'end': finish,
            'partial': cursor < start or finish > end,
        })
        cursor = shift(cursor, interval, 1)
    return buckets


def resolve_range(low, high, interval, anchor):
    """(start, end, error) -- the window to chart, defaults resolved before any query runs.

    `anchor` is the newest session in `dwp_reports`. It has to be, rather than today: the
    imported data ends well before the calendar does, so a window measured back from now
    matches nothing and reads as a broken chart.

    - neither bound: ends at the anchor, `default_buckets` wide
    - only a low bound: ends at the anchor
    - only a high bound: `default_buckets` back from the bucket holding it
    - both: exactly as asked

    A `None` anchor means an empty collection, and answers (None, None, None) -- the route
    turns that into an empty chart rather than into today's date or a 500.
    """
    spec = INTERVALS[interval]
    start, end = low, high

    if end is None:
        end = anchor
    if end is None:
        return None, None, None

    if start is None:
        start = shift(bucket_start(end, interval), interval, -(spec['default_buckets'] - 1))

    count = bucket_count(start, end, interval)
    if count > MAX_BUCKETS:
        return None, None, (
            f'the requested range is {count} buckets; the maximum is {MAX_BUCKETS} -- '
            f'widen the interval or narrow the dates'
        )
    return start, end, None


def series(criteria, start, end, interval):
    """Per-bucket totals across [start, end], every bucket present.

    **One pipeline, where Center.summary needs three.** That one needs three incompatible
    notions of distinct at the same time -- a pair of fields, an element of an array, a
    scalar. This needs exactly one, the student pair, and every other figure is additive
    *through* it: summing per student and then per bucket is the same number as summing per
    bucket directly. So the groups nest instead of the queries repeating.

    ⚠️ That holds only while nothing here counts distinct INSTRUCTORS or distinct DAYS per
    bucket. Either would need its own pass, and Center.summary becomes the precedent again.

    ⚠️ `students` is distinct *within* a bucket and does not sum across them: a student who
    came in February and in March is counted in both, which is right for a time series and
    wrong for anyone totalling the column.

    No `finalized` field: it is `sessions - unfinalized`. Center.EMPTY carries only the
    unfinalized side for the same reason -- two stored figures that must sum to a third are
    two figures that can disagree.
    """
    fmt = INTERVALS[interval]['format']

    rolled = {row['_id']: row for row in _collection().aggregate([
        {'$match': criteria},
        {'$group': {
            # Stage one is the distinct-student stage. ⚠️ BOTH key fields, never account_id
            # alone: an account is a household and 191 of them carry two to five siblings,
            # so grouping by the account would count a pair of them as one student.
            #
            # No `timezone` argument, ever. $dateToString defaults to UTC, and these
            # datetimes are naive wall clock stored as UTC -- a zone would shift every
            # boundary. Bucketing on `date` rather than `session_start` for the same
            # reason: it is indexed, stored at midnight, and is the field the caller's date
            # bounds filter, so the bucket and the filter cannot disagree by a few hours.
            '_id': {
                'key': {'$dateToString': {'format': fmt, 'date': '$date'}},
                'account_id': '$account_id',
                'student_name': '$student_name',
            },
            'sessions': {'$sum': 1},
            'pages_completed': {'$sum': '$pages_completed'},
            # A missing `finalized` counts as not finalized, as in Center.summary.
            'unfinalized': {'$sum': {'$cond': [{'$eq': ['$finalized', True]}, 0, 1]}},
        }},
        {'$group': {
            '_id': '$_id.key',
            'sessions': {'$sum': '$sessions'},
            'pages_completed': {'$sum': '$pages_completed'},
            'unfinalized': {'$sum': '$unfinalized'},
            # One row per student reached this stage, so counting rows counts students.
            'students': {'$sum': 1},
        }},
    ])}

    buckets = []
    for bucket in axis(start, end, interval):
        found = rolled.get(bucket['key'], {})
        buckets.append({
            **bucket,
            # `or default`: $sum over a field absent from every matched document answers 0,
            # but a collection holding nulls answers None on some drivers, and neither
            # should reach a chart -- Center.summary guards pages the same way.
            **{name: found.get(name) or default for name, default in EMPTY.items()},
        })
    return buckets
