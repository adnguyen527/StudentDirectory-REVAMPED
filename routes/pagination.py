"""Shared `?limit=&offset=` handling for the list endpoints.

Every list route pages by default rather than on request. The alternative -- unlimited
unless the caller asks otherwise -- leaves the full-collection response one URL away,
which is the problem this exists to close.
"""

from routes.serialization import serialize

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _int_arg(args, name, default, minimum):
    raw = args.get(name)
    if raw is None or raw == '':
        return default, None
    try:
        value = int(raw)
    except ValueError:
        return None, f'{name} must be a whole number'
    if value < minimum:
        return None, f'{name} must be {minimum} or greater'
    return value, None


def parse(args):
    """(limit, offset, error) from the query string. Both arguments are optional.

    limit is capped at MAX_LIMIT rather than refused: a caller asking for everything
    gets a full page and a total telling it more exists, which beats a 400 it has to
    learn about first. A limit of 0 is refused outright -- pymongo reads .limit(0) as
    "no limit", so accepting it would hand back the whole collection.
    """
    limit, error = _int_arg(args, 'limit', DEFAULT_LIMIT, minimum=1)
    if error:
        return None, None, error

    offset, error = _int_arg(args, 'offset', 0, minimum=0)
    if error:
        return None, None, error

    return min(limit, MAX_LIMIT), offset, None


def envelope(key, documents, total, limit, offset):
    """The list response shape: the rows under `key`, plus where they sit in the whole.

    `total` counts every match, not just this page, so a caller can size a pager
    without walking to the end.
    """
    return {
        key: serialize(documents),
        'page': {
            'limit': limit,
            'offset': offset,
            'total': total,
            'returned': len(documents),
        },
    }
