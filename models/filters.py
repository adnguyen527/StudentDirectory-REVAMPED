"""Query criteria shared by more than one model.

Kept out of any single model so neither has to import the other for a filter that belongs
to both. `students` and `instructors` store `centers` in the same shape -- a list of
`{name, sessions}` -- so one criterion serves the list route on either.
"""


def center_criteria(centers):
    """Rows at any of these centers, or no restriction when none are given.

    The filter is multi-select, so several names are a union rather than an intersection.
    On students that union is also a partition -- every student belongs to exactly one
    center -- but on instructors it is not: 11 of 103 work at two or more, so one of them
    answers two centers without being two people, and the per-center counts deliberately
    sum to more than the roster.

    An unrecognised name simply matches nothing. That looks like the `sort` allowlist the
    list routes are meant to grow, which answers 400 on a bad value, but it is the opposite
    case: "no rows at Xyz" is a correct answer to a filter, while `sort=bogus` has no
    correct answer. Do not "fix" this into a 400.

    Blank values are dropped first, so `?center=` means "no center filter" rather than
    "centers named empty string". Without that, a truncated URL answers 200 with an empty
    list, which reads as "no students here" -- and `?query=` already ignores its own empty
    value, so the two would disagree.
    """
    wanted = [name for name in (centers or []) if name]
    return {'centers.name': {'$in': wanted}} if wanted else {}
