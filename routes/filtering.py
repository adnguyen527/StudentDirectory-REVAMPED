"""Shared range handling for the list endpoints -- the `?<column>_min=` family.

The third of the query-string parsers, beside pagination and sorting, and the same shape:
it returns a value or a message and lets the route pick the status code.

Two suffix pairs rather than one, because the words are what make a URL readable:
`?sessions_min=5` and `?last_session_from=2025-06-01` each say what they mean, where
`last_session_min` would read as a count of sessions. Which pair a column takes is part of
its declaration -- see FILTERABLE on each model -- so a caller never has to guess.
"""

from datetime import datetime

DATE_FORMAT = '%Y-%m-%d'

# Per column kind: the suffixes it answers to.
BOUNDS = {
    'number': ('_min', '_max'),
    'date': ('_from', '_to'),
}


def _number(raw, name):
    try:
        # int where it can be, so a whole number is not stored or echoed as 5.0. One
        # column -- topics' median sessions -- is genuinely fractional.
        return (int(raw) if raw.lstrip('-').isdigit() else float(raw)), None
    except ValueError:
        return None, f'{name} must be a number'


def _date(raw, name):
    try:
        return datetime.strptime(raw, DATE_FORMAT), None
    except ValueError:
        return None, f'{name} must be a YYYY-MM-DD date'


PARSERS = {'number': _number, 'date': _date}


def parse(args, filterable):
    """({column: (low, high)}, error) from the query string. Every bound is optional.

    A column with neither bound given is absent from the result rather than present with
    two Nones, so a caller can tell "not filtered" from "filtered to everything".

    Blank values are dropped, as `?center=` and `?query=` already are: a truncated URL
    means no filter rather than a filter on nothing.

    A low bound above the high one is refused. An empty page would also be a defensible
    answer -- nothing is between 10 and 5 -- but every way of producing that pair is a
    mistake, and _parse_period already refuses the same shape for start/end.
    """
    bounds = {}

    for column, (_, kind) in filterable.items():
        low_suffix, high_suffix = BOUNDS[kind]
        parser = PARSERS[kind]
        values = []

        for suffix in (low_suffix, high_suffix):
            name = f'{column}{suffix}'
            raw = args.get(name)
            if raw is None or raw == '':
                values.append(None)
                continue
            value, error = parser(raw, name)
            if error:
                return None, error
            values.append(value)

        low, high = values
        if low is None and high is None:
            continue
        if low is not None and high is not None and low > high:
            return None, (
                f'{column}{low_suffix} must not be greater than {column}{high_suffix}'
            )
        bounds[column] = (low, high)

    return bounds, None
