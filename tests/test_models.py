"""Query layer: the students, dwp_reports and attendance_reports collections."""

import pytest

from models import Attendance, DigitalWorkoutPlan, Student
from tests.sample_data import (
    ACCOUNT_NGUYEN,
    ACCOUNT_TAN,
    ANTHONY_DWP_IDS,
    ANTHONY_KEY,
    AVA_KEY,
    CHLOE_KEY,
    _attendance,
    _day,
)


def names(students):
    return sorted(s['student_name'] for s in students)


class TestStudent:

    def test_find_all_returns_every_student(self, seeded_db):
        assert names(Student.find_all()) == ['Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan']

    def test_find_all_omits_the_report_id_plumbing(self, seeded_db):
        assert all('dwp_report_ids' not in s for s in Student.find_all())
        # The projection must not take anything else with it.
        assert all('total_sessions' in s for s in Student.find_all())

    def test_find_by_key_returns_one_sibling_not_the_household(self, seeded_db):
        student = Student.find_by_key(ANTHONY_KEY)
        assert student['student_name'] == 'Anthony Nguyen'
        assert student['total_sessions'] == 2

    def test_find_by_key_keeps_the_report_ids(self, seeded_db):
        """The detail view is the one place dwp_report_ids is actually needed."""
        assert Student.find_by_key(ANTHONY_KEY)['dwp_report_ids'] == ANTHONY_DWP_IDS

    def test_find_by_key_unknown_returns_none(self, seeded_db):
        assert Student.find_by_key('no-such-account_nobody') is None

    def test_find_by_account_returns_all_siblings(self, seeded_db):
        siblings = Student.find_by_account(ACCOUNT_NGUYEN)
        assert names(siblings) == ['Anthony Nguyen', 'Ava Nguyen']

    def test_find_by_account_isolates_households(self, seeded_db):
        assert names(Student.find_by_account(ACCOUNT_TAN)) == ['Chloe Tan']

    def test_find_by_account_unknown_returns_empty(self, seeded_db):
        assert Student.find_by_account('nope') == []

    def test_search_matches_partial_names(self, seeded_db):
        assert names(Student.search('Nguyen')) == ['Anthony Nguyen', 'Ava Nguyen']

    def test_search_is_case_insensitive(self, seeded_db):
        assert names(Student.search('chloe')) == ['Chloe Tan']

    @pytest.mark.parametrize('query', ['(', '[a-z', '*', '\\', '(?i)nguyen'])
    def test_search_treats_regex_metacharacters_as_literals(self, seeded_db, query):
        """The query reaches $regex directly, so it must be escaped: an unescaped
        pattern either errors or, as with '(?i)nguyen', matches nothing on purpose."""
        assert Student.search(query) == []

    def test_search_respects_the_limit(self, seeded_db):
        assert len(Student.search('n', limit=1)) == 1

    def test_search_omits_the_report_id_plumbing(self, seeded_db):
        assert all('dwp_report_ids' not in s for s in Student.search('Nguyen'))

    def test_count_all(self, seeded_db):
        assert Student.count_all() == 3

    def test_count_all_on_an_empty_collection(self, mongo):
        assert Student.count_all() == 0

    def test_student_key_is_unique(self, seeded_db):
        """Siblings differ only by name, so the key is the only thing stopping a
        rebuild from collapsing them."""
        from pymongo.errors import DuplicateKeyError

        with pytest.raises(DuplicateKeyError):
            seeded_db['students'].insert_one({
                'student_key': ANTHONY_KEY,
                'account_id': ACCOUNT_NGUYEN,
                'student_name': 'Anthony Nguyen',
            })


class TestDigitalWorkoutPlan:

    def test_find_by_student_excludes_siblings(self, seeded_db):
        reports = DigitalWorkoutPlan.find_by_student(ACCOUNT_NGUYEN, 'Anthony Nguyen')
        assert len(reports) == 2
        assert {r['student_name'] for r in reports} == {'Anthony Nguyen'}

    def test_find_by_student_sorts_newest_first(self, seeded_db):
        reports = DigitalWorkoutPlan.find_by_student(ACCOUNT_NGUYEN, 'Anthony Nguyen')
        assert [r['date'] for r in reports] == sorted(
            (r['date'] for r in reports), reverse=True
        )

    def test_find_by_student_requires_the_matching_account(self, seeded_db):
        """Name alone is not identity -- the wrong household returns nothing."""
        assert DigitalWorkoutPlan.find_by_student(ACCOUNT_TAN, 'Anthony Nguyen') == []

    def test_find_by_account_returns_every_siblings_sessions(self, seeded_db):
        reports = DigitalWorkoutPlan.find_by_account(ACCOUNT_NGUYEN)
        assert len(reports) == 3
        assert {r['student_name'] for r in reports} == {'Anthony Nguyen', 'Ava Nguyen'}

    def test_find_by_account_sorts_newest_first(self, seeded_db):
        dates = [r['date'] for r in DigitalWorkoutPlan.find_by_account(ACCOUNT_NGUYEN)]
        assert dates == sorted(dates, reverse=True)

    def test_count_all(self, seeded_db):
        assert DigitalWorkoutPlan.count_all() == 4

    @pytest.mark.parametrize('field', [
        'row_hash',
        'lead_id',
        'internal_notes',
        'notes_from_center_director',
        'notes_for_center_director',
    ])
    def test_private_fields_never_leave_the_model(self, seeded_db, field):
        """These are staff-internal or pure plumbing. The API has no client that needs
        them, so they are withheld at the query rather than filtered downstream."""
        for finder in (
            DigitalWorkoutPlan.find_by_student(ACCOUNT_TAN, 'Chloe Tan'),
            DigitalWorkoutPlan.find_by_account(ACCOUNT_TAN),
        ):
            assert finder, 'fixture returned nothing -- the assertion below is vacuous'
            assert all(field not in report for report in finder)

    def test_both_spellings_of_the_director_note_are_withheld(self, seeded_db):
        """The source renamed this column partway through the dataset. A filter written
        for the newer name alone still leaks the 23 populated older rows."""
        report = DigitalWorkoutPlan.find_by_student(ACCOUNT_TAN, 'Chloe Tan')[0]
        assert 'notes_from_center_director' not in report
        assert 'notes_for_center_director' not in report

    def test_the_work_itself_still_comes_through(self, seeded_db):
        """Withholding must not take the session with it."""
        report = DigitalWorkoutPlan.find_by_student(ACCOUNT_TAN, 'Chloe Tan')[0]
        assert report['session_summary_notes'] == 'worked through angle pairs'
        assert report['pages_completed'] == 7
        assert report['student_name'] == 'Chloe Tan'


class TestAttendance:

    def test_find_by_student_excludes_siblings(self, seeded_db):
        days = Attendance.find_by_student(ANTHONY_KEY)
        assert len(days) == 2
        assert {d['student_name'] for d in days} == {'Anthony Nguyen'}

    def test_find_by_student_sorts_newest_first(self, seeded_db):
        dates = [d['date'] for d in Attendance.find_by_student(ANTHONY_KEY)]
        assert dates == sorted(dates, reverse=True)

    def test_find_by_student_respects_the_limit(self, seeded_db):
        assert len(Attendance.find_by_student(ANTHONY_KEY, limit=1)) == 1

    def test_find_by_student_omits_the_report_id_plumbing(self, seeded_db):
        assert all('dwp_report_ids' not in d for d in Attendance.find_by_student(ANTHONY_KEY))

    def test_find_by_student_unknown_returns_empty(self, seeded_db):
        assert Attendance.find_by_student('no-such-account_nobody') == []

    def test_find_by_account_returns_the_household(self, seeded_db):
        days = Attendance.find_by_account(ACCOUNT_NGUYEN)
        assert {d['student_name'] for d in days} == {'Anthony Nguyen', 'Ava Nguyen'}

    def test_find_by_date_range_is_inclusive_on_both_bounds(self, seeded_db):
        days = Attendance.find_by_date_range(_day(2026, 3, 7), _day(2026, 3, 14))
        assert len(days) == 3
        assert {d['date'] for d in days} == {
            _day(2026, 3, 7), _day(2026, 3, 10), _day(2026, 3, 14)
        }

    def test_find_by_date_range_can_scope_to_one_student(self, seeded_db):
        days = Attendance.find_by_date_range(
            _day(2026, 3, 1), _day(2026, 3, 31), student_key=ANTHONY_KEY
        )
        assert {d['date'] for d in days} == {_day(2026, 3, 7), _day(2026, 3, 14)}

    def test_find_by_date_range_excludes_days_outside_it(self, seeded_db):
        """Chloe's only day is 2026-02-01, so a March window must not return her."""
        days = Attendance.find_by_date_range(_day(2026, 3, 1), _day(2026, 3, 31))
        assert CHLOE_KEY not in {d['student_key'] for d in days}
        assert len(days) == 3

    def test_count_all_counts_days_not_sessions(self, seeded_db):
        """Anthony's 3/14 covers two sessions but is one day attended."""
        assert Attendance.count_all() == 4
        assert sum(d['sessions'] for d in Attendance.find_by_student(ANTHONY_KEY)) == 3

    def test_count_by_student(self, seeded_db):
        assert Attendance.count_by_student(ANTHONY_KEY) == 2
        assert Attendance.count_by_student(CHLOE_KEY) == 1

    def test_at_home_days_are_kept_and_taggable(self, seeded_db):
        """@Home is attendance, distinguishable by delivery_method rather than absent."""
        in_center = list(seeded_db['attendance_reports'].find({'delivery_methods': 'In-Center'}))
        at_home = list(seeded_db['attendance_reports'].find({'delivery_methods': '@Home'}))
        assert len(in_center) == 3
        assert len(at_home) == 1
        assert at_home[0]['student_name'] == 'Chloe Tan'

    def test_period_summary_counts_sessions_not_days(self, seeded_db):
        """Anthony's 3/14 is two sessions on one day. A prepaid package draws down two,
        so the totals must differ."""
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 3, 1), _day(2026, 3, 31)
        )
        assert summary['totals'] == {'sessions': 3, 'days': 2}

    def test_period_summary_is_chronological(self, seeded_db):
        """Oldest first -- this reads as a statement, not a feed."""
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 3, 1), _day(2026, 3, 31)
        )
        dates = [v['date'] for v in summary['visits']]
        assert dates == sorted(dates)

    def test_period_summary_buckets_by_month(self, seeded_db):
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 1, 1), _day(2026, 12, 31)
        )
        assert summary['by_month'] == [{'month': '2026-03', 'sessions': 3, 'days': 2}]

    def test_period_summary_months_are_ordered(self, seeded_db):
        """A list, not a dict -- clients should not have to trust JSON key order."""
        summary = Attendance.period_summary(
            CHLOE_KEY, _day(2026, 1, 1), _day(2026, 12, 31)
        )
        months = [b['month'] for b in summary['by_month']]
        assert months == sorted(months)

    def test_period_summary_excludes_siblings(self, seeded_db):
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 3, 1), _day(2026, 3, 31)
        )
        assert {v['student_name'] for v in summary['visits']} == {'Anthony Nguyen'}

    @pytest.mark.parametrize('start,end,expected', [
        (_day(2026, 3, 7), _day(2026, 3, 14), 3),    # both bounds inclusive
        (_day(2026, 3, 8), _day(2026, 3, 14), 2),    # start excludes the 7th
        (_day(2026, 3, 7), _day(2026, 3, 13), 1),    # end excludes the 14th
    ])
    def test_period_summary_bounds_are_inclusive(self, seeded_db, start, end, expected):
        """date is stored at midnight, so an end of the 14th includes the 14th."""
        summary = Attendance.period_summary(ANTHONY_KEY, start, end)
        assert summary['totals']['sessions'] == expected

    def test_period_summary_of_an_empty_window_is_zero_not_missing(self, seeded_db):
        """A student who attended nothing is a real answer -- 'zero this period' is what
        the manager is calling about."""
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 5, 1), _day(2026, 5, 31)
        )
        assert summary == {'totals': {'sessions': 0, 'days': 0}, 'by_month': [], 'visits': []}

    def test_period_summary_counts_unfinalized_sessions(self, seeded_db):
        """The student attended. Whether the instructor closed the report is a staffing
        matter, not a reason to hand the family back a session."""
        seeded_db['attendance_reports'].insert_one(_attendance(
            ANTHONY_KEY, ACCOUNT_NGUYEN, 'Anthony Nguyen', _day(2026, 3, 20),
            sessions_timed=0, minutes_present=None, pages_completed=0,
        ))
        summary = Attendance.period_summary(
            ANTHONY_KEY, _day(2026, 3, 1), _day(2026, 3, 31)
        )
        assert summary['totals'] == {'sessions': 4, 'days': 3}

    def test_unmeasured_presence_is_null_not_zero(self, seeded_db):
        """0 would read as 'attended, stayed no time' -- a different claim."""
        day = Attendance.find_by_student(CHLOE_KEY)[0]
        assert day['sessions_timed'] == 0
        assert day['minutes_present'] is None


def test_students_and_reports_agree_on_session_counts(seeded_db):
    """The students collection is a rollup of dwp_reports; the two must not drift."""
    for key, name in [(ANTHONY_KEY, 'Anthony Nguyen'),
                      (AVA_KEY, 'Ava Nguyen'),
                      (CHLOE_KEY, 'Chloe Tan')]:
        student = Student.find_by_key(key)
        reports = DigitalWorkoutPlan.find_by_student(student['account_id'], name)
        assert student['total_sessions'] == len(reports)
        assert student['total_pages_completed'] == sum(
            r.get('pages_completed') or 0 for r in reports
        )
