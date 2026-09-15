"""Shared query-string handling for the three trend charts.

The fourth of the query-string parsers, beside pagination, sorting and filtering, and the
same shape: it returns values or a message and lets the route pick the status code.

It exists because the reports, home and instructor charts differ in what they *filter* by
and what they *draw*, but not at all in how they read `?interval=` and resolve a window.
Three copies of that would be three chances for one chart to anchor differently from the
others, which is exactly the drift the single `latest_session_date` anchor exists to stop.
"""

from models.dwp_report import FILTERABLE
from models.trends import DEFAULT_INTERVAL, INTERVAL_NAMES, INTERVALS, resolve_range
from routes import filtering
from routes.serialization import serialize

# Every bucket carries these, whatever the chart draws on top of them: the key it is
# matched by, the days it covers, and whether the window only covers part of it.
AXIS = ('key', 'start', 'end', 'partial')


def parse(args, anchor, default_interval=DEFAULT_INTERVAL):
    """(interval, start, end, error) from ?interval=, ?date_from= and ?date_to=.

    `?interval=` is an allowlist answered with a 400, exactly as `?sort=` is: an unknown
    interval has no correct answer. An unknown `?center=` or `?instructor=` is the opposite
    case and stays a 200 -- "nothing happened there" is a correct answer to a filter.

    A `start` of None with no error means an empty collection: there is no anchor to
    measure back from, and today's date is not one, so the route answers an empty chart.

    `default_interval` differs per chart -- the Home trends are monthly where the others
    are daily -- but the *window* for each interval is decided once, in models/trends.py,
    so a monthly chart is never handed a 30-day range.
    """
    interval = args.get('interval') or default_interval
    if interval not in INTERVALS:
        return None, None, None, f'interval must be one of: {INTERVAL_NAMES}'

    # ?date_from= and ?date_to=, both inclusive -- the same pair, parsed by the same code,
    # that /api/reports filters its table by. The chart sits above that table.
    ranges, error = filtering.parse(args, FILTERABLE)
    if error:
        return None, None, None, error

    low, high = ranges.get('date', (None, None))
    start, end, error = resolve_range(low, high, interval, anchor)
    if error:
        return None, None, None, error

    return interval, start, end, None


def envelope(interval, start, end, buckets, metrics, **selection):
    """The response every trend route answers in.

    `metrics` names the series this chart draws; the rest of what `series` computed is
    dropped here rather than shipped for nobody, so each endpoint's response is a list of
    fields with a reader. The bucket key and its dates always travel.

    The interval, the resolved range and the caller's own filter selection are echoed for
    the reason /api/centers/metrics echoes its centers: the response outlives the request
    that asked for it, in a cache or a screenshot, and "12 buckets" means nothing without
    the window they cover.
    """
    return {
        'interval': interval,
        'range': serialize({'start': start, 'end': end}) if start else None,
        **{name: sorted({value for value in values if value})
           for name, values in selection.items()},
        'buckets': serialize([
            {name: bucket[name] for name in AXIS + metrics} for bucket in buckets
        ]),
    }
