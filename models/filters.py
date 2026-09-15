"""Query criteria shared by more than one model.

Kept out of any single model so neither has to import the other for a filter that belongs
to both. `students` and `instructors` store `centers` in the same shape -- a list of
`{name, sessions}` -- so one criterion serves the list route on either. `dwp_reports` does
not, which is what the `field` argument below is for.
"""

# Where the center names sit on students and instructors: a list of {name, sessions}, so
# the criterion has to reach through the array into a subfield.
CENTER_FIELD = 'centers.name'

# Where the instructor names sit on dwp_reports: a bare list of strings, so the criterion
# matches the array itself rather than a subfield of it.
INSTRUCTOR_FIELD = 'instructors'


def any_of(values, field):
    """`{field: {'$in': [...]}}` for a multi-select, or no restriction when none are given.

    The mechanism under every multi-select filter here, extracted because the centers and
    the instructors filters are the same query with a different field. `$in` against an
    array field matches if any element does, which is what lets one criterion serve a bare
    list of strings and a list of subdocuments alike -- only `field` changes.

    Blank values are dropped first, so `?center=` means "no center filter" rather than
    "centers named empty string". Without that, a truncated URL answers 200 with an empty
    list, which reads as "no students here" -- and `?query=` already ignores its own empty
    value, so the two would disagree.

    An unrecognised value simply matches nothing. That looks like the `sort` allowlist the
    list routes are meant to grow, which answers 400 on a bad value, but it is the opposite
    case: "no rows at Xyz" is a correct answer to a filter, while `sort=bogus` has no
    correct answer. Do not "fix" this into a 400.
    """
    wanted = [value for value in (values or []) if value]
    return {field: {'$in': wanted}} if wanted else {}


def center_criteria(centers, field=CENTER_FIELD):
    """Rows at any of these centers, or no restriction when none are given.

    `field` names where the center lives, because the collections do not agree. Students
    and instructors carry `[{name, sessions}]` and take the default; `dwp_reports` carries
    a bare list of strings and passes `centers`. The criterion is otherwise identical.

    The filter is multi-select, so several names are a union rather than an intersection.
    On students that union is also a partition -- every student belongs to exactly one
    center -- but on instructors it is not: 11 of 103 work at two or more, so one of them
    answers two centers without being two people, and the per-center counts deliberately
    sum to more than the roster.

    ⚠️ This matches a *document* if any of its centers matches, which is not the same as
    selecting those centers. An aggregation that `$unwind`s `centers` after this has to
    match again afterwards or it emits the centers the caller filtered out -- see
    models/distribution.py, which is the one place that matters.
    """
    return any_of(centers, field)


def instructor_criteria(instructors, field=INSTRUCTOR_FIELD):
    """Sessions taught by any of these instructors.

    The same multi-select shape as the center filter, against `dwp_reports.instructors`.
    A co-taught session carries several names and matches on any of them.

    ⚠️ There is no index on `instructors`, so this must always ride a bounded `date` --
    which the trends routes guarantee by resolving a default range before they query.

    ⚠️ Pages are credited, not split. A co-taught session is one session either way, but
    its pages count in full for each instructor on it, so two single-instructor requests
    added together overshoot the real total -- models/center.py has the figures.
    """
    return any_of(instructors, field)


def range_criteria(bounds, filterable):
    """`{field: {'$gte': low, '$lte': high}}` for the columns a caller bounded.

    `bounds` is what routes/filtering.py parsed -- `{column: (low, high)}` in the URL's
    names -- and `filterable` maps those to the stored fields, so the two halves stay
    honest about which columns exist without either importing the other.

    Both ends are inclusive. "5 or more sessions" is what a person means by a minimum of
    5, and the dates are stored at midnight, so `$lte` on a date includes that whole day.

    ⚠️ A bounded column excludes the documents that have no value for it, because null
    satisfies neither `$gte` nor `$lte`. That is right -- a topic nobody has finished has
    no median, and asking for medians under 5 is not asking for it -- but it means a
    filter on a nullable column silently shrinks the list by more than the bound suggests,
    and the UI has to say so where it offers one.
    """
    criteria = {}
    for column, (low, high) in (bounds or {}).items():
        field, _ = filterable[column]
        bound = {}
        if low is not None:
            bound['$gte'] = low
        if high is not None:
            bound['$lte'] = high
        if bound:
            criteria[field] = bound
    return criteria
