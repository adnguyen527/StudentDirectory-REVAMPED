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


class TestAttendance:

    def test_find_all(self, seeded_db):
        assert len(Attendance.find_all()) == 4

    def test_find_by_student_id_filters_on_account(self, seeded_db):
        records = Attendance.find_by_student_id(ACCOUNT_TAN)
        assert len(records) == 1
        assert records[0]['Student Name'] == 'Chloe Tan'

    def test_find_by_student_id_is_household_scoped(self, seeded_db):
        """attendance_reports are keyed by 'Account Id', so this returns siblings
        together -- the parameter name says student, the data says household."""
        records = Attendance.find_by_student_id(ACCOUNT_NGUYEN)
        assert {r['Student Name'] for r in records} == {'Anthony Nguyen', 'Ava Nguyen'}

    def test_find_by_student_id_unknown_returns_empty(self, seeded_db):
        assert Attendance.find_by_student_id('nope') == []

    def test_count_all(self, seeded_db):
        assert Attendance.count_all() == 4


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
