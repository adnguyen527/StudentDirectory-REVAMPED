"""Row parsing in import_reports.py.

These are pure functions over the compound strings the Excel exports carry, so they are
testable without a database. `Key: Value;  Key: Value` is the source's own format --
semicolon, two spaces.
"""

from datetime import datetime

import pytest

from ingestion.import_reports import (
    _bool,
    _int,
    _none,
    _parse_date,
    _split,
    _to_snake,
    parse_center,
    parse_general_information,
    parse_lp_assignment,
    parse_session,
    row_hash,
    transform_dwp_row,
)

SESSION = ('Sessions This Month: 4;  Session Start: 3:58 PM;  '
           'Session End: 5:05 PM;  Instructors: Dana Reyes, Sam Ortiz')


class TestHelpers:

    def test_split_reads_the_compound_format(self):
        assert _split('A: 1;  B: two') == {'A': '1', 'B': 'two'}

    def test_split_keeps_colons_inside_a_value(self):
        """Times contain colons; only the first one separates key from value."""
        assert _split('Session Start: 3:58 PM') == {'Session Start': '3:58 PM'}

    @pytest.mark.parametrize('value', [None, '', 0])
    def test_split_of_nothing_is_empty(self, value):
        assert _split(value) == {}

    @pytest.mark.parametrize('value,expected', [
        ('5', 5), (5, 5), ('None', None), (None, None), ('', None), ('abc', None),
    ])
    def test_int(self, value, expected):
        assert _int(value) == expected

    @pytest.mark.parametrize('value,expected', [
        ('Yes', True), ('yes', True), ('No', False), ('anything', False), (None, None),
    ])
    def test_bool(self, value, expected):
        assert _bool(value) is expected

    @pytest.mark.parametrize('value,expected', [
        ('None', None), (None, None), ('  None  ', None), ('real', 'real'), (0, 0),
    ])
    def test_none_treats_the_string_as_a_null(self, value, expected):
        assert _none(value) == expected

    def test_parse_date(self):
        assert _parse_date('01/02/2025') == datetime(2025, 1, 2)

    @pytest.mark.parametrize('value', [None, '', 'not a date', '2025-01-02'])
    def test_parse_date_rejects_what_it_cannot_read(self, value):
        assert _parse_date(value) is None

    def test_to_snake(self):
        assert _to_snake('Account Id') == 'account_id'
        assert _to_snake('Delivery Method') == 'delivery_method'


class TestParseSession:

    def test_reads_a_full_session(self):
        assert parse_session(SESSION) == {
            'sessions_this_month': 4,
            'session_start': '3:58 PM',
            'session_end': '5:05 PM',
            'instructors': ['Dana Reyes', 'Sam Ortiz'],
        }

    def test_a_missing_end_time_is_null_not_the_string_none(self):
        """The source writes the literal 'None' for a session with no recorded end.
        Storing that string made 217 documents carry a time-shaped value that is not a
        time, which every downstream consumer then had to special-case."""
        parsed = parse_session('Session Start: 3:58 PM;  Session End: None')
        assert parsed['session_end'] is None
        assert parsed['session_start'] == '3:58 PM'

    def test_a_missing_start_time_is_null_too(self):
        parsed = parse_session('Session Start: None;  Session End: 5:05 PM')
        assert parsed['session_start'] is None

    def test_an_absent_field_is_also_null(self):
        parsed = parse_session('Sessions This Month: 1')
        assert parsed['session_start'] is None
        assert parsed['session_end'] is None

    def test_a_single_instructor(self):
        assert parse_session('Instructors: Dana Reyes')['instructors'] == ['Dana Reyes']

    def test_no_instructors_is_an_empty_list(self):
        assert parse_session('Sessions This Month: 1')['instructors'] == []

    def test_empty_input(self):
        assert parse_session(None) == {
            'sessions_this_month': None,
            'session_start': None,
            'session_end': None,
            'instructors': [],
        }


class TestOtherParsers:

    def test_general_information(self):
        parsed = parse_general_information(
            'Session Page Goal: 6;  Pages Completed: 5;  Last Punch of the Day: No'
        )
        assert parsed['session_page_goal'] == 6
        assert parsed['pages_completed'] == 5
        assert parsed['last_punch_of_day'] is False

    def test_center_is_a_list(self):
        assert parse_center('Tyler, Mann Mathematics') == ['Tyler, Mann Mathematics']

    def test_center_of_nothing(self):
        assert parse_center(None) == []

    def test_lp_assignment_topics(self):
        topics = parse_lp_assignment('T-100 (Fractions): Mastered;  T-200 (Angles): Worked On')
        assert topics == [
            {'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'},
            {'id': 'T-200', 'name': 'Angles', 'status': 'Worked On'},
        ]

    def test_lp_assignment_keeps_what_it_cannot_parse(self):
        """An unrecognised entry is preserved raw rather than dropped."""
        assert parse_lp_assignment('gibberish') == [{'raw': 'gibberish'}]


class TestRowHash:

    def test_is_stable_across_key_order(self):
        assert row_hash({'a': 1, 'b': 2}) == row_hash({'b': 2, 'a': 1})

    def test_ignores_id_and_its_own_field(self):
        from bson import ObjectId

        base = {'a': 1}
        assert row_hash(base) == row_hash(
            {'a': 1, '_id': ObjectId(), 'row_hash': 'stale'}
        )

    def test_differs_on_content(self):
        assert row_hash({'a': 1}) != row_hash({'a': 2})

    def test_a_null_end_time_hashes_differently_than_the_string(self):
        """Consequence of the parser fix: a corrected row is a different document as far
        as idempotency is concerned, so backfill_session_times.py has to rewrite
        row_hash alongside the value."""
        assert row_hash({'session_end': None}) != row_hash({'session_end': 'None'})


class TestTransformDwpRow:

    def test_builds_a_document_from_a_row(self):
        doc = transform_dwp_row({
            'Account Id': 'acct-1',
            'Student Name': 'Anthony Nguyen',
            'Date': '01/02/2025',
            'Delivery Method': 'In-Center',
            'Session': SESSION,
            'General Information': 'Pages Completed: 5',
            'Center': 'Tyler',
            'LP Assignment': 'T-100 (Fractions): Mastered',
        })

        assert doc['account_id'] == 'acct-1'
        assert doc['student_name'] == 'Anthony Nguyen'
        assert doc['date'] == datetime(2025, 1, 2)
        assert doc['delivery_method'] == 'In-Center'
        assert doc['centers'] == ['Tyler']
        assert doc['instructors'] == ['Dana Reyes', 'Sam Ortiz']
        assert doc['pages_completed'] == 5
        assert doc['topics'] == [{'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'}]
        assert doc['row_hash']

    def test_compound_columns_do_not_survive_as_raw_fields(self):
        doc = transform_dwp_row({'Session': SESSION, 'Date': '01/02/2025'})
        assert 'session' not in doc
        assert 'Session' not in doc
