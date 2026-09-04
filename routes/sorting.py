"""Shared `?sort=&direction=` handling for the list endpoints.

The order half of what routes/pagination.py does for `?limit=&offset=`, and deliberately
the same shape: parse returns a value or a message, and the route decides the status code.
"""

DIRECTIONS = ('asc', 'desc')


def parse(args, allowed):
    """(sort key, direction, error) from the query string. Both arguments are optional.

    An unrecognised column is refused with a 400 rather than ignored. That is the opposite
    of what center_criteria does with an unknown center name, and the difference is the
    point: "no students at Xyz" is a correct answer to a filter, while there is no correct
    answer to `sort=bogus` -- silently serving name order would be a wrong answer wearing
    the right status code. The message names the columns, so the mistake is self-correcting.

    A named column with no direction is left for the model to resolve, since the sensible
    first direction is a property of the column: names read A-Z, counts read largest first.
    """
    key = args.get('sort')
    if key is None or key == '':
        # `?direction=desc` alone sorts nothing. It is not worth a 400 -- there is no
        # ambiguity about what the caller gets -- but it must not be read as an order.
        return None, None, None

    if key not in allowed:
        return None, None, f"sort must be one of: {', '.join(sorted(allowed))}"

    direction = args.get('direction')
    if direction is None or direction == '':
        return key, None, None

    if direction not in DIRECTIONS:
        return None, None, "direction must be 'asc' or 'desc'"

    return key, direction, None
