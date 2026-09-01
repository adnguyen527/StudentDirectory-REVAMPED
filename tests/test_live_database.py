"""Read-only integrity checks against the real cluster.

Opt in with `pytest --integration`. Nothing here writes; the point is to catch a bad
ingestion run -- duplicate keys, orphaned report references, rollups that drifted away
from the dwp_reports they summarise -- before the API serves it.

ASSUMPTION -- instructor names are unique people. A DWP row carries an instructor's
name and nothing else: there is no instructor uid anywhere in the source data, so
`instructors` is keyed on `instructor_name` and every instructor check below inherits
that. Two distinct people who share a name are already merged into one document by the
time these tests run, and no assertion here can see it -- the merged document is
internally consistent, just wrong about who it describes. Distinguishing them needs a
uid in the source, not a stricter test. The student side does not share this weakness:
students are keyed by account_id + name (see util.make_student_key), so a name
collision only merges students who are also on the same household account.
"""

import pytest

from util import make_student_key, split_student_key

pytestmark = pytest.mark.integration

REQUIRED_STUDENT_FIELDS = [
    'student_key', 'account_id', 'student_name', 'total_sessions',
    'total_pages_completed', 'dwp_report_ids',
]

# The three rungs of the topic ladder. Anything else the source writes is not rolled up.
KNOWN_TOPIC_STATUSES = {'Worked On', 'Completed', 'Mastered'}

# Where a topic stands after its most recent assignment.
KNOWN_TOPIC_STATES = {'finished', 'on_plan', 'removed'}


@pytest.fixture(scope='module')
def students(live_db):
    docs = list(live_db['students'].find())
    if not docs:
        pytest.skip('students collection is empty -- run ingestion/build_students.py')
    return docs


@pytest.fixture(scope='module')
def instructors(live_db):
    docs = list(live_db['instructors'].find())
    if not docs:
        pytest.skip('instructors collection is empty -- run ingestion/build_instructors.py')
    return docs


@pytest.fixture(scope='module')
def attendance(live_db):
    docs = list(live_db['attendance_reports'].find())
    if not docs:
        pytest.skip('attendance_reports is empty -- run ingestion/build_attendance.py')
    return docs


def test_expected_collections_exist(live_db):
    expected = {'students', 'dwp_reports', 'instructors'}
    assert expected <= set(live_db.list_collection_names())


def test_students_is_not_empty(students):
    assert len(students) > 0


def test_every_student_has_the_required_fields(students):
    missing = [
        (s.get('student_key'), field)
        for s in students for field in REQUIRED_STUDENT_FIELDS
        if s.get(field) is None
    ]
    assert not missing, f'{len(missing)} missing field(s), e.g. {missing[:5]}'


def test_student_keys_are_unique(students):
    keys = [s['student_key'] for s in students]
    duplicates = {k for k in keys if keys.count(k) > 1}
    assert not duplicates, f'duplicate student_key: {sorted(duplicates)[:5]}'


def test_student_keys_match_their_account_and_name(students):
    """A key that no longer derives from its own fields cannot be looked up by any
    caller that rebuilds it with make_student_key()."""
    mismatched = [
        s['student_key'] for s in students
        if s['student_key'] != make_student_key(s['account_id'], s['student_name'])
    ]
    assert not mismatched, f'{len(mismatched)} stale key(s), e.g. {mismatched[:5]}'


def test_student_keys_split_back_to_their_account(students):
    assert all(
        split_student_key(s['student_key'])[0] == s['account_id'] for s in students
    )


def test_student_key_index_is_unique(live_db):
    indexes = live_db['students'].index_information()
    key_indexes = [
        spec for spec in indexes.values()
        if [f for f, _ in spec['key']] == ['student_key']
    ]
    assert key_indexes, 'no index on student_key'
    assert any(spec.get('unique') for spec in key_indexes)


def test_the_paging_sort_is_index_backed(live_db):
    """/api/students pages on (student_name, student_key). Without the compound index
    the sort cannot use student_name_1 alone, and every page becomes a collection scan
    plus a blocking in-memory sort -- which also puts the query under a 32 MB ceiling."""
    keys = [
        [f for f, _ in spec['key']] for spec in
        live_db['students'].index_information().values()
    ]
    assert ['student_name', 'student_key'] in keys, (
        'no compound index for the paged sort -- see ingestion/build_students.py'
    )


def test_paging_by_name_never_repeats_or_skips_a_student(live_db):
    """17 students share a name with someone, so the tiebreak is not hypothetical:
    an unstable sort can hand the same student back on two pages and drop another."""
    from models.student import LIST_SORT

    seen, offset, limit = [], 0, 200
    while True:
        page = list(
            live_db['students'].find({}, {'student_key': 1})
            .sort(LIST_SORT).skip(offset).limit(limit)
        )
        if not page:
            break
        seen.extend(s['student_key'] for s in page)
        offset += limit

    assert len(seen) == len(set(seen)), 'a student appeared on two pages'
    assert len(seen) == live_db['students'].count_documents({})


def test_siblings_share_an_account_without_colliding(students):
    """Households with 2-5 students are the norm here, and the reason account_id alone
    is not identity. If none show up, the rollup collapsed them."""
    by_account = {}
    for s in students:
        by_account.setdefault(s['account_id'], set()).add(s['student_name'])

    households = {a: n for a, n in by_account.items() if len(n) > 1}
    assert households, 'no multi-student households found -- siblings likely merged'


def test_no_orphaned_dwp_report_references(live_db, students):
    """Every id in dwp_report_ids must still resolve to a dwp_reports document."""
    referenced = {oid for s in students for oid in s.get('dwp_report_ids', [])}
    found = live_db['dwp_reports'].count_documents({'_id': {'$in': list(referenced)}})
    assert found == len(referenced), f'{len(referenced) - found} orphaned reference(s)'


def test_session_counts_match_the_reference_lists(students):
    drifted = [
        s['student_key'] for s in students
        if s['total_sessions'] != len(s.get('dwp_report_ids', []))
    ]
    assert not drifted, f'{len(drifted)} rollup(s) out of sync, e.g. drifted[:5]={drifted[:5]}'


def test_every_dwp_report_belongs_to_a_known_student(live_db, students):
    """Reports ingested after the last build_students.py run have no profile to hang
    off, so the API cannot surface them."""
    known = {s['student_key'] for s in students}
    orphans = []
    for doc in live_db['dwp_reports'].find(
        {}, {'account_id': 1, 'student_name': 1}
    ):
        account_id, name = doc.get('account_id'), doc.get('student_name')
        if not account_id or not name or not str(name).strip():
            continue  # build_students.py skips these by design
        if make_student_key(account_id, str(name).strip()) not in known:
            orphans.append(doc['_id'])

    assert not orphans, f'{len(orphans)} dwp_report(s) with no student, e.g. {orphans[:5]}'


def test_topic_rollup_counts_match_their_history(students):
    """The two summary counts are 'ever reached this status', derived from topics[]."""
    drifted = [
        s['student_key'] for s in students
        if s.get('total_unique_topics_mastered')
        != sum(1 for t in s.get('topics', []) if t.get('times_mastered'))
        or s.get('total_unique_topics_completed')
        != sum(1 for t in s.get('topics', []) if t.get('times_completed'))
    ]
    assert not drifted, f'{len(drifted)} topic count(s) out of sync, e.g. {drifted[:5]}'


def test_finished_topics_count_completed_and_mastered(students):
    """The figure a profile page shows. Mastered implies completed, and the source writes
    one status per session, so a topic mastered but never marked Completed still counts."""
    drifted = [
        s['student_key'] for s in students
        if s.get('total_unique_topics_finished')
        != sum(1 for t in s.get('topics', [])
               if t.get('times_completed') or t.get('times_mastered'))
    ]
    assert not drifted, f'{len(drifted)} finished count(s) out of sync, e.g. {drifted[:5]}'


def test_finished_is_never_smaller_than_mastered_or_completed(students):
    """It is a union of the two, so it cannot be below either part -- and it is well
    above the completed count, because 8,739 topics were mastered without ever being
    written as Completed."""
    impossible = [
        s['student_key'] for s in students
        if s.get('total_unique_topics_finished', 0) < s.get('total_unique_topics_mastered', 0)
        or s.get('total_unique_topics_finished', 0) < s.get('total_unique_topics_completed', 0)
    ]
    assert not impossible, f'{len(impossible)} impossible finished count(s), e.g. {impossible[:5]}'

    assert (
        sum(s.get('total_unique_topics_finished', 0) for s in students)
        > sum(s.get('total_unique_topics_completed', 0) for s in students)
    ), 'finished should far exceed completed -- most topics are mastered, not completed'


def test_topic_sessions_account_for_every_status(students):
    """sessions is the whole history, so the three status counts must exhaust it."""
    drifted = [
        (s['student_key'], t.get('id')) for s in students for t in s.get('topics', [])
        if t.get('sessions') != (t.get('times_worked_on', 0)
                                 + t.get('times_completed', 0)
                                 + t.get('times_mastered', 0))
    ]
    assert not drifted, f'{len(drifted)} topic(s) with unaccounted sessions, e.g. {drifted[:5]}'


def test_topics_reconcile_to_dwp_reports(live_db, students):
    """Every (student, topic) pair on a session must appear in that student's topics[],
    with the same number of sessions behind it, and nothing may appear that no session
    backs. A mismatch means students was built from an older snapshot of dwp_reports."""
    from_reports = {}
    for doc in live_db['dwp_reports'].find(
        {'topics.0': {'$exists': True}},
        {'account_id': 1, 'student_name': 1, 'topics': 1},
    ):
        account_id, name = doc.get('account_id'), doc.get('student_name')
        if not account_id or not name or not str(name).strip():
            continue  # build_students.py skips these by design
        key = make_student_key(account_id, str(name).strip())
        for topic in doc.get('topics', []):
            if topic.get('status') not in KNOWN_TOPIC_STATUSES:
                continue  # not rolled up, by design
            pair = (key, topic.get('id') or topic.get('raw', ''))
            from_reports[pair] = from_reports.get(pair, 0) + 1

    from_students = {
        (s['student_key'], t.get('id')): t.get('sessions')
        for s in students for t in s.get('topics', [])
    }
    assert from_students == from_reports, (
        f'{len(set(from_reports) - set(from_students))} pair(s) missing from students, '
        f'{len(set(from_students) - set(from_reports))} with no session to back them'
    )


def test_a_topic_may_be_both_mastered_and_completed(students):
    """Not a bug: the source moves a topic between statuses over time, and one history
    entry records every status it held rather than only the last."""
    overlapping = [
        s['student_key'] for s in students for t in s.get('topics', [])
        if t.get('times_mastered') and t.get('times_completed')
    ]
    assert overlapping, 'expected at least one topic both mastered and completed'


def test_every_topic_was_assigned_at_least_once(students):
    impossible = [
        (s['student_key'], t.get('id')) for s in students for t in s.get('topics', [])
        if not t.get('times_assigned') or t['times_assigned'] < 1
    ]
    assert not impossible, f'{len(impossible)} topic(s) never assigned, e.g. {impossible[:5]}'


def test_reassignments_are_recorded(students):
    """A topic taken off the plan and given back later. If this ever reads zero the build
    stopped reading a student's days in order, and an assignment is a sequence or it is
    nothing."""
    reassigned = [
        (s['student_key'], t.get('id')) for s in students for t in s.get('topics', [])
        if t.get('times_assigned', 1) > 1
    ]
    assert reassigned, 'no repeat assignments found -- are the days still being ordered?'


def test_reassignment_totals_match_the_history(students):
    drifted = [
        s['student_key'] for s in students
        if s.get('total_topic_reassignments')
        != sum(t.get('times_assigned', 1) - 1 for t in s.get('topics', []))
    ]
    assert not drifted, f'{len(drifted)} reassignment total(s) out of sync, e.g. {drifted[:5]}'


def test_every_topic_has_a_known_status_and_state(students):
    impossible = [
        (s['student_key'], t.get('id')) for s in students for t in s.get('topics', [])
        if t.get('status') not in KNOWN_TOPIC_STATUSES
        or t.get('state') not in KNOWN_TOPIC_STATES
    ]
    assert not impossible, f'{len(impossible)} topic(s) in an unknown state, e.g. {impossible[:5]}'


def test_topic_states_partition_the_history(students):
    """Every topic is finished, still on the plan, or gone -- exactly one of the three."""
    drifted = [
        s['student_key'] for s in students
        if s.get('total_topics_on_plan', 0) + s.get('total_topics_removed', 0)
        + sum(1 for t in s.get('topics', []) if t.get('state') == 'finished')
        != len(s.get('topics', []))
    ]
    assert not drifted, f'{len(drifted)} student(s) whose states do not add up, e.g. {drifted[:5]}'


def test_a_finished_state_means_the_last_assignment_finished(students):
    """Not the same question as total_unique_topics_finished, which asks 'ever'. A topic
    mastered and then assigned again is not finished now, so the state count must be at or
    below the ever count -- and strictly below it somewhere, or the two are measuring the
    same thing and one of them is redundant."""
    state_finished = sum(
        1 for s in students for t in s.get('topics', []) if t.get('state') == 'finished'
    )
    ever_finished = sum(s.get('total_unique_topics_finished', 0) for s in students)
    assert state_finished <= ever_finished
    assert state_finished < ever_finished, (
        'no topic was finished and then assigned again -- expected some, given '
        'reassignment after a failed assessment is routine'
    )


def test_topic_dates_are_ordered(students):
    dated = [
        (s['student_key'], t.get('id')) for s in students for t in s.get('topics', [])
        if t.get('first_seen') and t.get('last_seen')
        and t['first_seen'] > t['last_seen']
    ]
    assert not dated, f'{len(dated)} topic(s) seen last before first, e.g. {dated[:5]}'


def test_totals_are_non_negative(students):
    assert all(
        s['total_sessions'] >= 0 and s['total_pages_completed'] >= 0 for s in students
    )


def test_no_session_time_holds_the_string_none(live_db):
    """A time-shaped field must hold a time or a null, never the word 'None'.

    parse_session guarantees this for anything imported after the _none() fix. Rows
    imported before it need ingestion/migrations/backfill_session_times.py --apply; until that has
    been run, this fails with the 217 rows it will correct.
    """
    stuck = live_db['dwp_reports'].count_documents(
        {'$or': [{'session_start': 'None'}, {'session_end': 'None'}]}
    )
    assert stuck == 0, (
        f"{stuck} row(s) still store 'None' as a session time -- "
        f"run ingestion/migrations/backfill_session_times.py --apply"
    )


KNOWN_CENTERS = {'Southlake', 'North Dallas', 'Tyler', 'Forney'}


def test_center_names_are_locations_not_location_plus_brand(live_db):
    """A center is a place. The operating brand belongs in center_orgs.

    Every location rebranded from 'Mann Mathematics' to 'Math Made Simple' on
    2025-09-05, so a brand left inside the name splits one location's history into
    three. Rows imported before the parse_center fix need
    ingestion/migrations/backfill_center_split.py --apply.
    """
    for name in ['dwp_reports', 'students', 'instructors', 'attendance_reports']:
        found = set()
        for doc in live_db[name].find({}, {'centers': 1}):
            for value in doc.get('centers', []) or []:
                found.add(value['name'] if isinstance(value, dict) else value)
        unexpected = {c for c in found if ', ' in str(c)}
        assert not unexpected, f'{name} holds unsplit center value(s): {sorted(unexpected)[:5]}'
        assert found <= KNOWN_CENTERS, f'{name} has unknown center(s): {sorted(found - KNOWN_CENTERS)}'


def test_every_student_belongs_to_one_location(live_db, students):
    """893/893 before the rebrand was split back out, and it must stay that way --
    a student attending across the September rename is still at one place."""
    spread = [s['student_key'] for s in students if len(s.get('centers', [])) > 1]
    assert not spread, f'{len(spread)} student(s) now span locations, e.g. {spread[:5]}'


def test_one_attendance_document_per_student_day(attendance):
    keys = [(d['student_key'], d['date']) for d in attendance]
    duplicates = {k for k in keys if keys.count(k) > 1}
    assert not duplicates, f'{len(duplicates)} student-day(s) recorded twice'


def test_attendance_compound_index_is_unique(live_db, attendance):
    """(student_key, date) is what stops a rebuild from splitting one visit in two."""
    indexes = live_db['attendance_reports'].index_information()
    compound = [
        spec for spec in indexes.values()
        if [f for f, _ in spec['key']] == ['student_key', 'date']
    ]
    assert compound, 'no compound index on (student_key, date)'
    assert any(spec.get('unique') for spec in compound)


def test_attendance_days_belong_to_real_students(live_db, attendance):
    known = {s['student_key'] for s in live_db['students'].find({}, {'student_key': 1})}
    unknown = {d['student_key'] for d in attendance if d['student_key'] not in known}
    assert not unknown, f'{len(unknown)} attendance day(s) with no student profile'


def test_attendance_covers_every_usable_dwp_row(live_db, attendance):
    """Sessions across all days must reconcile to the dwp_reports that carry the three
    fields a day is built from. A shortfall means rows were dropped, not collapsed."""
    usable = live_db['dwp_reports'].count_documents({
        'account_id': {'$nin': [None, '']},
        'student_name': {'$nin': [None, '']},
        'date': {'$ne': None},
    })
    assert sum(d['sessions'] for d in attendance) == usable


def test_attendance_day_count_matches_distinct_student_days(live_db, attendance):
    """The whole point of the collection: fewer days than sessions, by exactly the
    number of repeat visits."""
    distinct = next(live_db['dwp_reports'].aggregate([
        {'$match': {'account_id': {'$nin': [None, '']},
                    'student_name': {'$nin': [None, '']},
                    'date': {'$ne': None}}},
        {'$group': {'_id': {'a': '$account_id', 's': '$student_name', 'd': '$date'}}},
        {'$count': 'days'},
    ]), {}).get('days', 0)
    assert len(attendance) == distinct


def test_attendance_pages_reconcile_to_dwp_reports(live_db, attendance):
    """Unlike instructors, a day belongs to one student, so pages are not double-counted
    and the totals must match exactly."""
    recorded = next(live_db['dwp_reports'].aggregate([
        {'$match': {'account_id': {'$nin': [None, '']},
                    'student_name': {'$nin': [None, '']},
                    'date': {'$ne': None}}},
        {'$group': {'_id': None, 'pages': {'$sum': '$pages_completed'}}},
    ]), {}).get('pages', 0)
    assert sum(d['pages_completed'] for d in attendance) == recorded


def test_no_orphaned_attendance_report_references(live_db, attendance):
    referenced = {oid for d in attendance for oid in d.get('dwp_report_ids', [])}
    found = live_db['dwp_reports'].count_documents({'_id': {'$in': list(referenced)}})
    assert found == len(referenced), f'{len(referenced) - found} orphaned reference(s)'


def test_attendance_session_counts_match_their_reference_lists(attendance):
    drifted = [
        (d['student_key'], d['date']) for d in attendance
        if d['sessions'] != len(d.get('dwp_report_ids', []))
    ]
    assert not drifted, f'{len(drifted)} day(s) out of sync, e.g. {drifted[:5]}'


def test_unmeasured_presence_is_null_rather_than_zero(attendance):
    """A day with no trustworthy session times must not claim zero minutes -- that
    reads as 'attended, stayed no time', which is a measurement, not its absence."""
    wrong = [
        (d['student_key'], d['date']) for d in attendance
        if (d['sessions_timed'] == 0) != (d['minutes_present'] is None)
    ]
    assert not wrong, f'{len(wrong)} day(s) disagree, e.g. {wrong[:5]}'


def test_every_attendance_day_has_a_delivery_method(attendance):
    missing = [d['student_key'] for d in attendance if not d.get('delivery_methods')]
    assert not missing, f'{len(missing)} day(s) with no delivery method'


def test_at_home_days_are_present_and_tagged(attendance):
    """@Home sessions are kept, not filtered out at build time -- if none survive, the
    builder dropped them and the decision cannot be reversed without a rebuild."""
    at_home = [d for d in attendance if '@Home' in d.get('delivery_methods', [])]
    assert at_home, 'no @Home attendance days -- were they filtered out?'


def test_attendance_minutes_are_plausible(attendance):
    from ingestion.build_attendance import MAX_SESSION_MINUTES

    implausible = [
        (d['student_key'], d['minutes_present']) for d in attendance
        if d['minutes_present'] is not None
        and not (0 <= d['minutes_present'] <= MAX_SESSION_MINUTES * d['sessions'])
    ]
    assert not implausible, f'e.g. {implausible[:5]}'


def test_the_finalized_flag_agrees_with_the_page_count(live_db):
    """finalized is defined as `pages_completed is not None` and nothing else. Rows
    imported before the flag existed need ingestion/migrations/backfill_finalized.py --apply."""
    wrong = live_db['dwp_reports'].count_documents({
        '$or': [
            {'finalized': True, 'pages_completed': None},
            {'finalized': False, 'pages_completed': {'$ne': None}},
            {'finalized': {'$exists': False}},
        ]
    })
    assert wrong == 0, f'{wrong} row(s) disagree with their page count'


def test_unfinalized_sessions_are_kept_not_deleted(live_db):
    """968 of them are the only record of their student-day, so they are attendance.
    If this hits zero, someone filtered them out of the source collection."""
    assert live_db['dwp_reports'].count_documents({'finalized': False}) > 0


def test_instructor_unfinalized_never_exceeds_sessions_taught(instructors):
    impossible = [
        i['instructor_name'] for i in instructors
        if i.get('unfinalized_sessions', 0) > i.get('total_sessions_taught', 0)
    ]
    assert not impossible, f'e.g. {impossible[:5]}'


def test_instructor_unfinalized_totals_reconcile(live_db, instructors):
    """Co-taught sessions credit each instructor, so the sum runs at or above the row
    count -- never below it, which would mean sessions went uncounted."""
    rows = live_db['dwp_reports'].count_documents({
        'finalized': False, 'instructors.0': {'$exists': True},
    })
    assert sum(i.get('unfinalized_sessions', 0) for i in instructors) >= rows


def test_instructor_names_are_unique(instructors):
    """One document per name -- which is one document per *person* only under the
    module's assumption that no two instructors share a name. This catches a broken
    build, not a name collision: a collision produces exactly one document too."""
    names = [i['instructor_name'] for i in instructors]
    duplicates = {n for n in names if names.count(n) > 1}
    assert not duplicates, f'duplicate instructor_name: {sorted(duplicates)[:5]}'


def test_instructor_name_index_is_unique(live_db):
    indexes = live_db['instructors'].index_information()
    name_indexes = [
        spec for spec in indexes.values()
        if [f for f, _ in spec['key']] == ['instructor_name']
    ]
    assert name_indexes, 'no index on instructor_name'
    assert any(spec.get('unique') for spec in name_indexes)


def test_instructor_rosters_point_at_real_students(live_db, instructors):
    """students[] is keyed by student_key; a key with no profile means the two
    aggregates were built from different snapshots of dwp_reports."""
    known = {s['student_key'] for s in live_db['students'].find({}, {'student_key': 1})}
    dangling = {
        entry['student_key']
        for i in instructors for entry in i.get('students', [])
        if entry.get('student_key') and entry['student_key'] not in known
    }
    assert not dangling, f'{len(dangling)} unknown student_key(s), e.g. {sorted(dangling)[:5]}'


def test_instructor_roster_size_matches_its_count(instructors):
    drifted = [
        i['instructor_name'] for i in instructors
        if i.get('unique_students') != len(i.get('students', []))
    ]
    assert not drifted, f'{len(drifted)} roster count(s) out of sync, e.g. {drifted[:5]}'


def test_instructor_topic_counts_match_their_list(instructors):
    drifted = [
        i['instructor_name'] for i in instructors
        if i.get('unique_topics_taught') != len(i.get('topics', []))
    ]
    assert not drifted, f'{len(drifted)} instructor(s), e.g. {drifted[:5]}'


def test_instructor_topics_are_ranked_by_sessions(instructors):
    """The profile page reads 'most taught' top down."""
    unsorted_instructors = [
        i['instructor_name'] for i in instructors
        if [(-t['sessions'], t['name']) for t in i.get('topics', [])]
        != sorted((-t['sessions'], t['name']) for t in i.get('topics', []))
    ]
    assert not unsorted_instructors, f'e.g. {unsorted_instructors[:5]}'


def test_instructor_topics_and_topic_instructors_are_the_same_pairs(instructors, topics):
    """The two aggregates hold one relationship from opposite sides, the way students[]
    here mirrors students.instructors[]. Both credit each instructor on a co-taught
    session in full, so they must agree pair for pair -- if they do not, one of the two
    was built from a different dwp_reports than the other."""
    from_instructors = {
        (i['instructor_name'], t['topic_id']): t['sessions']
        for i in instructors for t in i.get('topics', [])
    }
    from_topics = {
        (i['name'], t['topic_id']): i['sessions']
        for t in topics for i in t.get('instructors', [])
    }
    assert from_instructors == from_topics, (
        f'{len(set(from_instructors) - set(from_topics))} pair(s) only on the instructor '
        f'side, {len(set(from_topics) - set(from_instructors))} only on the topic side'
    )


def test_instructor_topics_name_them_the_way_the_topics_page_does(instructors, topics_by_id):
    """Both sides run build_topics.canonical_name, so a topic the source spells two ways
    cannot read one way on the topic page and another on the instructor page."""
    drifted = [
        (i['instructor_name'], t['topic_id'], t['name'], topics_by_id[t['topic_id']]['name'])
        for i in instructors for t in i.get('topics', [])
        if t['topic_id'] in topics_by_id
        and t['name'] != topics_by_id[t['topic_id']]['name']
    ]
    assert not drifted, f'{len(drifted)} topic(s) named differently, e.g. {drifted[:3]}'


def test_instructor_topics_point_at_real_topics(instructors, topics_by_id):
    unknown = {
        t['topic_id'] for i in instructors for t in i.get('topics', [])
        if t['topic_id'] not in topics_by_id
    }
    assert not unknown, f'{len(unknown)} unknown topic(s), e.g. {sorted(unknown)[:5]}'


def test_instructor_days_taught_matches_its_count(instructors):
    drifted = [
        i['instructor_name'] for i in instructors
        if i.get('total_days_taught') != len(i.get('days_taught', []))
    ]
    assert not drifted, f'{len(drifted)} day count(s) out of sync, e.g. {drifted[:5]}'


def test_co_taught_sessions_are_a_subset_of_sessions_taught(instructors):
    """Co-taught sessions are counted inside total_sessions_taught, not alongside."""
    impossible = [
        i['instructor_name'] for i in instructors
        if i.get('co_taught_sessions', 0) > i.get('total_sessions_taught', 0)
    ]
    assert not impossible, f'e.g. {impossible[:5]}'


def test_instructor_pages_overshoot_is_bounded(live_db, instructors):
    """Co-taught sessions credit each instructor the full page count, so the
    instructor total legitimately exceeds the recorded total -- but only by the pages
    inside co-taught sessions. A larger gap means something is double-counting."""
    recorded = next(live_db['dwp_reports'].aggregate([
        {'$group': {'_id': None, 'pages': {'$sum': '$pages_completed'}}}
    ]), {}).get('pages', 0)
    credited = sum(i.get('total_pages_completed', 0) for i in instructors)

    co_taught_pages = next(live_db['dwp_reports'].aggregate([
        {'$match': {'$expr': {'$gt': [{'$size': {'$ifNull': ['$instructors', []]}}, 1]}}},
        {'$group': {'_id': None, 'pages': {'$sum': '$pages_completed'}}}
    ]), {}).get('pages', 0)

    assert credited >= recorded
    # Worst case every co-taught session has 5 instructors; anything past that is a bug.
    assert credited - recorded <= co_taught_pages * 5


# --- topics ----------------------------------------------------------------------
#
# The program-wide rollup, one document per topic_id, built by ingestion/build_topics.py.
# One document per topic is what lets the Topics tab list them: a topic appearing twice
# is not a list.
#
# Three ids carry two names each, and only one of them is a rename -- PK-3121-00, where
# the old name stops the week the new one starts. On the other two, both names run side
# by side for the topic's whole life. So the name is settled by a rule rather than a map
# (most recently used, then most sessions, then alphabetical) and the names not chosen
# are kept in also_known_as.
#
# The builder reads dwp_reports and calls build_students.build_topic_history per student,
# so this collection and students.topics[] are not independent measurements -- they share
# the code that decides what an assignment is. What the reconciliations below catch is the
# two builds having been run against different snapshots of dwp_reports, which is the
# realistic way they drift. The first, ad-hoc build of this collection came out two
# sessions short of the student rollup, and that is exactly what showed it.

REQUIRED_TOPIC_FIELDS = [
    'topic_id', 'name', 'sessions', 'times_worked_on', 'times_completed',
    'times_mastered', 'first_taught', 'last_taught', 'unique_students',
    'unique_instructors', 'instructors', 'also_known_as', 'students_finished',
    'students_on_plan', 'students_removed', 'students_ever_finished',
    'total_reassignments',
]

# median_sessions_to_finish is deliberately absent: it is null for a topic nobody has
# finished, which is a real answer rather than a missing field. See
# test_the_median_is_present_exactly_when_someone_finished.

TOPIC_COUNT_FIELDS = [
    'sessions', 'times_worked_on', 'times_completed', 'times_mastered',
    'unique_students', 'unique_instructors', 'students_finished', 'students_on_plan',
    'students_removed', 'students_ever_finished', 'total_reassignments',
]


@pytest.fixture(scope='module')
def topics(live_db):
    docs = list(live_db['topics'].find())
    if not docs:
        pytest.skip('topics collection is empty -- run ingestion/build_topics.py')
    return docs


@pytest.fixture(scope='module')
def topics_by_id(topics):
    """The collection keyed by id -- the grain students uses, and now its own grain."""
    return {t['topic_id']: t for t in topics}


@pytest.fixture(scope='module')
def student_topics_by_id(students):
    """The same rollup rebuilt from students.topics[] -- the independent second opinion."""
    folded = {}
    for s in students:
        for t in s.get('topics') or []:
            entry = folded.setdefault(t.get('id'), {
                'sessions': 0, 'times_worked_on': 0, 'times_completed': 0,
                'times_mastered': 0, 'students': set(), 'reassignments': 0,
                'first_taught': None, 'last_taught': None,
            })
            for field in ['sessions', 'times_worked_on', 'times_completed',
                          'times_mastered']:
                entry[field] += t.get(field, 0)
            entry['students'].add(s['student_key'])
            entry['reassignments'] += t.get('times_assigned', 1) - 1
            if t.get('first_seen') and (entry['first_taught'] is None
                                        or t['first_seen'] < entry['first_taught']):
                entry['first_taught'] = t['first_seen']
            if t.get('last_seen') and (entry['last_taught'] is None
                                       or t['last_seen'] > entry['last_taught']):
                entry['last_taught'] = t['last_seen']
    return folded


@pytest.fixture(scope='module')
def dwp_topic_names(live_db):
    """Every name the source spells each topic id with -- what the canonical name and
    also_known_as are checked against."""
    names = {}
    for doc in live_db['dwp_reports'].find(
        {'topics.0': {'$exists': True}}, {'topics': 1}
    ):
        for topic in doc.get('topics') or []:
            if topic.get('status') not in KNOWN_TOPIC_STATUSES:
                continue  # not rolled up, so it does not get a say in the name
            names.setdefault(
                topic.get('id') or topic.get('raw', ''), set()
            ).add(topic.get('name'))
    return names


@pytest.fixture(scope='module')
def dwp_topic_rollup(live_db):
    """One pass over dwp_reports for the session count and the distinct instructors
    behind each topic id -- the source both aggregates are derived from.

    Keyed on the id alone, matching the collection: a renamed topic's sessions belong to
    the one topic, whichever name the row happened to spell it with."""
    sessions, instructors_seen = {}, {}
    for doc in live_db['dwp_reports'].find(
        {'topics.0': {'$exists': True}}, {'topics': 1, 'instructors': 1}
    ):
        # Stripped and blank-dropped the way build_topics does. This is checking the
        # counting, not the name cleanup -- normalising differently here would fail on
        # whitespace the builder is right to remove.
        names = {
            (i['name'] if isinstance(i, dict) else i).strip()
            for i in doc.get('instructors') or []
            if i and (i['name'] if isinstance(i, dict) else i).strip()
        }
        for topic in doc.get('topics') or []:
            if topic.get('status') not in KNOWN_TOPIC_STATUSES:
                continue  # not rolled up, by design
            topic_id = topic.get('id') or topic.get('raw', '')
            sessions[topic_id] = sessions.get(topic_id, 0) + 1
            if names:
                counts = instructors_seen.setdefault(topic_id, {})
                for name in names:
                    counts[name] = counts.get(name, 0) + 1
    return sessions, instructors_seen


def test_topics_collection_is_not_empty(topics):
    assert len(topics) > 0


def test_every_topic_has_the_required_fields(topics):
    missing = [
        (t.get('topic_id'), t.get('name'), field)
        for t in topics for field in REQUIRED_TOPIC_FIELDS
        if t.get(field) is None
    ]
    assert not missing, f'{len(missing)} missing field(s), e.g. {missing[:5]}'


def test_topic_ids_are_unique(topics):
    """A topic that appears twice is not a list, and the Topics tab lists topics."""
    ids = [t['topic_id'] for t in topics]
    duplicates = {i for i in ids if ids.count(i) > 1}
    assert not duplicates, f'duplicate topic_id: {sorted(duplicates)[:5]}'


def test_the_topic_key_index_is_unique(live_db):
    """The id is the document's identity, so a rebuild that writes one twice has to fail
    at the database rather than quietly split a topic across two rows."""
    indexes = live_db['topics'].index_information()
    key_indexes = [
        spec for spec in indexes.values()
        if [f for f, _ in spec['key']] == ['topic_id']
    ]
    assert key_indexes, 'no index on topic_id'
    assert any(spec.get('unique') for spec in key_indexes)


def test_topics_are_listable_in_the_order_the_tab_wants(live_db):
    """The Topics tab leads with the most worked topics, and searches by name. Neither
    should be a collection scan."""
    keys = [
        [f for f, _ in spec['key']]
        for spec in live_db['topics'].index_information().values()
    ]
    assert any(k[:1] == ['sessions'] for k in keys), 'no index led by sessions'
    assert any(k[:1] == ['name'] for k in keys), 'no index led by name'


def test_topic_collection_sessions_account_for_every_status(topics):
    """sessions is the whole history, so the three rungs of the ladder must exhaust it.

    Named apart from the students-side check of the same shape above: two module-level
    functions of one name would leave only the second one running."""
    drifted = [
        (t['topic_id'], t['name']) for t in topics
        if t['sessions'] != (t.get('times_worked_on', 0)
                             + t.get('times_completed', 0)
                             + t.get('times_mastered', 0))
    ]
    assert not drifted, f'{len(drifted)} topic(s) with unaccounted sessions, e.g. {drifted[:5]}'


def test_every_topic_was_taught_to_somebody(topics):
    """A document with no sessions or no students has nothing behind it and should never
    have been written. Instructors are deliberately not part of this -- see below."""
    empty = [
        (t['topic_id'], t['name']) for t in topics
        if t.get('sessions', 0) < 1 or t.get('unique_students', 0) < 1
    ]
    assert not empty, f'{len(empty)} topic(s) with nothing behind them, e.g. {empty[:5]}'


def test_an_unstaffed_session_still_counts(topics):
    """unique_instructors == 0 is a real state, not a broken join.

    73 dwp rows name no instructor, 23 of them carrying topics, and one topic --
    PK-0140-06 'Volume', a single session -- has no staffed session at all. The rollup
    is right to keep it: dropping the topic, or the session, would lose work a student
    actually did because the paperwork was incomplete. Anything using this field to
    rank instructors has to treat zero as unknown rather than as a real zero.
    """
    unstaffed = [t for t in topics if t.get('unique_instructors', 0) == 0]
    assert all(t['sessions'] >= 1 and t['unique_students'] >= 1 for t in unstaffed), (
        'an unstaffed topic still has to have the session and student behind it'
    )
    assert len(unstaffed) < len(topics) * 0.01, (
        f'{len(unstaffed)} of {len(topics)} topics have no instructor -- that is a '
        f'broken join, not incomplete paperwork'
    )


def test_topic_counts_are_non_negative(topics):
    assert all(
        min(t.get(field, 0) for field in TOPIC_COUNT_FIELDS) >= 0 for t in topics
    )


def test_topic_collection_dates_are_ordered(topics):
    backwards = [
        (t['topic_id'], t['name']) for t in topics
        if t.get('first_taught') and t.get('last_taught')
        and t['first_taught'] > t['last_taught']
    ]
    assert not backwards, f'{len(backwards)} taught last before first, e.g. {backwards[:5]}'


def test_a_topic_cannot_have_more_students_than_sessions(topics):
    """Every student who worked a topic took at least one session on it."""
    impossible = [
        (t['topic_id'], t['name']) for t in topics
        if t.get('unique_students', 0) > t.get('sessions', 0)
    ]
    assert not impossible, f'{len(impossible)} with more students than sessions, e.g. {impossible[:5]}'


def test_a_topic_carrying_two_names_is_still_one_document(topics_by_id, dwp_topic_names):
    """Three ids are spelled two ways in the source. Each has to come out as one document
    with the alternate recorded -- the first build of this collection kept both names as
    separate rows, which is what made the topics unlistable."""
    multi = {
        topic_id for topic_id, names in dwp_topic_names.items()
        if len({n for n in names if n}) > 1
    }
    assert multi, 'no topic id carries two names -- the source changed, recheck the rule'
    missing = [topic_id for topic_id in multi if topic_id not in topics_by_id]
    assert not missing, f'{len(missing)} multi-named id(s) with no document: {missing[:5]}'
    silent = [topic_id for topic_id in multi if not topics_by_id[topic_id]['also_known_as']]
    assert not silent, f'{len(silent)} id(s) carrying two names but listing no alternate'


def test_also_known_as_holds_exactly_the_names_not_chosen(topics_by_id, dwp_topic_names):
    """A search for the old name still has to find the topic, so every name the source
    wrote is either the chosen one or an alternate -- none are dropped."""
    wrong = [
        (topic_id, doc['name'], doc.get('also_known_as'))
        for topic_id, doc in topics_by_id.items()
        if topic_id in dwp_topic_names
        and sorted(doc.get('also_known_as') or [])
        != sorted({n for n in dwp_topic_names[topic_id] if n} - {doc['name']})
    ]
    assert not wrong, f'{len(wrong)} bad also_known_as, e.g. {wrong[:3]}'


def test_a_topic_is_never_listed_under_its_own_alternate_name(topics):
    self_referential = [
        (t['topic_id'], t['name']) for t in topics
        if t['name'] in (t.get('also_known_as') or [])
    ]
    assert not self_referential, f'e.g. {self_referential[:5]}'


def test_every_topic_id_appears_in_students(topics_by_id, student_topics_by_id):
    """Both aggregates summarise the same dwp_reports. An id in one and not the other
    means they were built from different snapshots of it."""
    only_topics = set(topics_by_id) - set(student_topics_by_id)
    only_students = set(student_topics_by_id) - set(topics_by_id)
    assert not only_topics and not only_students, (
        f'{len(only_topics)} id(s) only in topics, e.g. {sorted(only_topics)[:5]}; '
        f'{len(only_students)} only in students, e.g. {sorted(only_students)[:5]}'
    )


def test_topic_status_counts_reconcile_to_students(topics_by_id, student_topics_by_id):
    """Per id, not per document -- see the note at the top of this section."""
    drifted = [
        (topic_id, field, topics_by_id[topic_id][field], student_topics_by_id[topic_id][field])
        for topic_id in set(topics_by_id) & set(student_topics_by_id)
        for field in ['sessions', 'times_worked_on', 'times_completed', 'times_mastered']
        if topics_by_id[topic_id][field] != student_topics_by_id[topic_id][field]
    ]
    assert not drifted, f'{len(drifted)} count(s) out of sync, e.g. {drifted[:5]}'


def test_topic_dates_reconcile_to_students(topics_by_id, student_topics_by_id):
    drifted = [
        (topic_id, field, topics_by_id[topic_id][field], student_topics_by_id[topic_id][field])
        for topic_id in set(topics_by_id) & set(student_topics_by_id)
        for field in ['first_taught', 'last_taught']
        if topics_by_id[topic_id][field] != student_topics_by_id[topic_id][field]
    ]
    assert not drifted, f'{len(drifted)} date(s) out of sync, e.g. {drifted[:5]}'


def test_topic_student_counts_reconcile_to_students(topics_by_id, student_topics_by_id):
    """One document per id means unique_students is now exact, not an upper bound.

    Under the old one-document-per-name layout this could only be checked as an
    inequality, because a student who worked both names of a renamed topic was counted
    under each. Collapsing to the id removed that double count.
    """
    drifted = [
        (topic_id, topics_by_id[topic_id]['unique_students'],
         len(student_topics_by_id[topic_id]['students']))
        for topic_id in set(topics_by_id) & set(student_topics_by_id)
        if topics_by_id[topic_id]['unique_students']
        != len(student_topics_by_id[topic_id]['students'])
    ]
    assert not drifted, f'{len(drifted)} student count(s) out of sync, e.g. {drifted[:5]}'


def test_topic_reassignments_reconcile_to_students(topics_by_id, student_topics_by_id):
    """Both sides count an assignment with the same code, so a disagreement here is the
    two builds having read different dwp_reports."""
    assert sum(t['total_reassignments'] for t in topics_by_id.values()) == sum(
        entry['reassignments'] for entry in student_topics_by_id.values()
    )


def test_topic_states_partition_the_students(topics):
    """Every student who worked a topic finished it, is still on it, or came off it."""
    drifted = [
        t['topic_id'] for t in topics
        if t['students_finished'] + t['students_on_plan'] + t['students_removed']
        != t['unique_students']
    ]
    assert not drifted, f'{len(drifted)} topic(s) whose states do not add up, e.g. {drifted[:5]}'


def test_ever_finished_is_never_below_finished_now(topics):
    """'Ever' cannot be rarer than 'now': everyone finished now finished it at least once.
    The gap the other way is expected -- that is a topic finished and then handed back."""
    impossible = [
        t['topic_id'] for t in topics
        if t['students_ever_finished'] < t['students_finished']
    ]
    assert not impossible, f'{len(impossible)} topic(s), e.g. {impossible[:5]}'


def test_the_median_is_present_exactly_when_someone_finished(topics):
    """Null is the honest answer for a topic nobody has finished, and the only case."""
    drifted = [
        t['topic_id'] for t in topics
        if (t.get('median_sessions_to_finish') is None)
        != (t['students_ever_finished'] == 0)
    ]
    assert not drifted, f'{len(drifted)} topic(s) with a mismatched median, e.g. {drifted[:5]}'


def test_topic_documents_cover_every_taught_topic(topics, dwp_topic_rollup):
    sessions, _ = dwp_topic_rollup
    live = {t['topic_id'] for t in topics}
    missing = set(sessions) - live
    unbacked = live - set(sessions)
    assert not missing and not unbacked, (
        f'{len(missing)} taught topic(s) with no document, e.g. {sorted(missing)[:5]}; '
        f'{len(unbacked)} document(s) no session backs, e.g. {sorted(unbacked)[:5]}'
    )


def test_topic_instructor_counts_reconcile_to_dwp_reports(topics, dwp_topic_rollup):
    """unique_instructors cannot come from students.topics[] -- that carries no
    instructor -- so this is the only check on the dwp join behind it."""
    _, instructors_seen = dwp_topic_rollup
    drifted = [
        (t['topic_id'], t['unique_instructors'],
         len(instructors_seen.get(t['topic_id'], ())))
        for t in topics
        if t['unique_instructors'] != len(instructors_seen.get(t['topic_id'], ()))
    ]
    assert not drifted, f'{len(drifted)} instructor count(s) out of sync, e.g. {drifted[:5]}'


def test_the_instructor_ranking_reconciles_to_dwp_reports(topics, dwp_topic_rollup):
    """Not just how many taught a topic, but how much each of them taught it -- the
    numbers the topic page ranks on."""
    _, instructors_seen = dwp_topic_rollup
    drifted = [
        (t['topic_id'], t['name'])
        for t in topics
        if {i['name']: i['sessions'] for i in t.get('instructors', [])}
        != instructors_seen.get(t['topic_id'], {})
    ]
    assert not drifted, f'{len(drifted)} ranking(s) out of sync, e.g. {drifted[:5]}'


def test_the_instructor_list_is_ranked_by_sessions(topics):
    """The page reads it top down, so the order is the data, not a detail."""
    unsorted_topics = [
        t['topic_id'] for t in topics
        if [(-i['sessions'], i['name']) for i in t.get('instructors', [])]
        != sorted((-i['sessions'], i['name']) for i in t.get('instructors', []))
    ]
    assert not unsorted_topics, f'{len(unsorted_topics)} out of order, e.g. {unsorted_topics[:5]}'


def test_unique_instructors_matches_the_instructor_list(topics):
    drifted = [
        t['topic_id'] for t in topics
        if t['unique_instructors'] != len(t.get('instructors', []))
    ]
    assert not drifted, f'{len(drifted)} topic(s), e.g. {drifted[:5]}'


def test_every_instructor_credit_is_a_real_session(topics):
    empty = [
        (t['topic_id'], i['name']) for t in topics
        for i in t.get('instructors', []) if i['sessions'] < 1
    ]
    assert not empty, f'{len(empty)} credit(s) of nothing, e.g. {empty[:5]}'


def test_co_teaching_makes_the_credits_overshoot_the_sessions(topics):
    """Each instructor on a co-taught session is credited the whole entry, so the credits
    across a topic can exceed its sessions -- they are per-instructor figures, not a
    breakdown. Asserting equality here would be wrong; what must never happen is coming in
    *under* the session count, which would mean sessions with nobody credited."""
    short = [
        (t['topic_id'], sum(i['sessions'] for i in t.get('instructors', [])), t['sessions'])
        for t in topics
        if t.get('instructors')
        and sum(i['sessions'] for i in t['instructors']) < t['sessions']
    ]
    assert not short, f'{len(short)} topic(s) crediting less than they taught, e.g. {short[:5]}'

    credited = sum(i['sessions'] for t in topics for i in t.get('instructors', []))
    taught = sum(t['sessions'] for t in topics)
    assert credited > taught, (
        'no co-taught overshoot at all -- 10% of topic entries have two instructors, so '
        'either the credit rule changed or the join is dropping them'
    )


def test_topic_instructors_are_real_instructors(live_db, topics):
    """Mirrors the instructor-roster check: a name here that has no document cannot be
    linked to from the topic page."""
    known = {i['instructor_name'] for i in live_db['instructors'].find({}, {'instructor_name': 1})}
    unknown = {
        i['name'] for t in topics for i in t.get('instructors', [])
        if i['name'] not in known
    }
    assert not unknown, f'{len(unknown)} unknown instructor(s), e.g. {sorted(unknown)[:5]}'


def test_topic_sessions_reconcile_to_dwp_reports(topics, dwp_topic_rollup):
    """The source rows behind each topic, counted straight off dwp_reports.

    A session is one topic entry on one report, not one report: two reports list the
    same topic twice in their own topics[], once Worked On and once Mastered. Both
    students.topics[] and this count are supposed to count both entries -- if they
    disagree, one topic shows two different session counts depending on whether you
    are looking at a profile card or the topics list.
    """
    sessions, _ = dwp_topic_rollup
    drifted = [
        (t['topic_id'], t['sessions'], sessions.get(t['topic_id']))
        for t in topics
        if t['sessions'] != sessions.get(t['topic_id'])
    ]
    assert not drifted, (
        f'{len(drifted)} topic(s) whose sessions disagree with dwp_reports '
        f'(document, source): {drifted[:5]}'
    )
