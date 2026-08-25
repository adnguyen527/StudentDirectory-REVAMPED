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


def test_totals_are_non_negative(students):
    assert all(
        s['total_sessions'] >= 0 and s['total_pages_completed'] >= 0 for s in students
    )


def test_no_session_time_holds_the_string_none(live_db):
    """A time-shaped field must hold a time or a null, never the word 'None'.

    parse_session guarantees this for anything imported after the _none() fix. Rows
    imported before it need ingestion/backfill_session_times.py --apply; until that has
    been run, this fails with the 217 rows it will correct.
    """
    stuck = live_db['dwp_reports'].count_documents(
        {'$or': [{'session_start': 'None'}, {'session_end': 'None'}]}
    )
    assert stuck == 0, (
        f"{stuck} row(s) still store 'None' as a session time -- "
        f"run ingestion/backfill_session_times.py --apply"
    )


KNOWN_CENTERS = {'Southlake', 'North Dallas', 'Tyler', 'Forney'}


def test_center_names_are_locations_not_location_plus_brand(live_db):
    """A center is a place. The operating brand belongs in center_orgs.

    Every location rebranded from 'Mann Mathematics' to 'Math Made Simple' on
    2025-09-05, so a brand left inside the name splits one location's history into
    three. Rows imported before the parse_center fix need
    ingestion/backfill_center_split.py --apply.
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
        if i.get('total_students_taught') != len(i.get('students', []))
    ]
    assert not drifted, f'{len(drifted)} roster count(s) out of sync, e.g. {drifted[:5]}'


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
