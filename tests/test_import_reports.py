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
    _parse_finalized_date,
    _split,
    combine_session_time,
    _to_snake,
    is_finalized,
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

    @pytest.mark.parametrize('value,expected', [
        (' 01/02/2025 \n 3:59 PM', datetime(2025, 1, 2, 15, 59)),
        (' 9/21/2024 \n 12:06 PM', datetime(2024, 9, 21, 12, 6)),
        ('12/14/2024 \n 12:27 AM', datetime(2024, 12, 14, 0, 27)),
        ('01/02/2025', datetime(2025, 1, 2)),
    ])
    def test_parse_finalized_date(self, value, expected):
        """The source packs date and time into one cell separated by a newline."""
        assert _parse_finalized_date(value) == expected

    @pytest.mark.parametrize('value', [None, '', '   ', 'None', 'not a date'])
    def test_parse_finalized_date_of_nothing(self, value):
        assert _parse_finalized_date(value) is None

    def test_parse_finalized_date_is_idempotent(self):
        """Re-running the backfill must not re-parse what it already converted."""
        already = datetime(2025, 1, 2, 15, 59)
        assert _parse_finalized_date(already) is already

    def test_to_snake(self):
        assert _to_snake('Account Id') == 'account_id'
        assert _to_snake('Delivery Method') == 'delivery_method'


class TestParseSession:

    def test_reads_a_full_session(self):
        """parse_session sees only the Session cell, so it yields clock strings.
        transform_dwp_row joins them to the date -- see TestCombineSessionTime."""
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


class TestCombineSessionTime:
    """A clock reading and the session date are two halves of one moment. Joining them
    once at import is what makes session times sortable and subtractable."""

    def test_joins_a_clock_reading_to_its_date(self):
        assert combine_session_time(datetime(2025, 1, 2), '3:58 PM') == datetime(2025, 1, 2, 15, 58)

    def test_a_datetime_passes_through_unchanged(self):
        """Re-running the backfill must not re-join what it already joined."""
        already = datetime(2025, 1, 2, 15, 58)
        assert combine_session_time(datetime(2025, 1, 2), already) is already

    @pytest.mark.parametrize('value', [None, 'None', '', 'not a time'])
    def test_no_usable_time_is_none(self, value):
        assert combine_session_time(datetime(2025, 1, 2), value) is None

    def test_no_date_means_no_moment(self):
        assert combine_session_time(None, '3:58 PM') is None

    def test_transform_stores_datetimes_not_strings(self):
        doc = transform_dwp_row({'Date': '01/02/2025', 'Session': SESSION})
        assert doc['session_start'] == datetime(2025, 1, 2, 15, 58)
        assert doc['session_end'] == datetime(2025, 1, 2, 17, 5)

    def test_a_row_with_no_end_time_keeps_its_start(self):
        doc = transform_dwp_row({
            'Date': '01/02/2025',
            'Session': 'Session Start: 3:58 PM;  Session End: None',
        })
        assert doc['session_start'] == datetime(2025, 1, 2, 15, 58)
        assert doc['session_end'] is None


class TestOtherParsers:

    def test_general_information(self):
        parsed = parse_general_information(
            'Session Page Goal: 6;  Pages Completed: 5;  Last Punch of the Day: No'
        )
        assert parsed['session_page_goal'] == 6
        assert parsed['pages_completed'] == 5
        assert parsed['last_punch_of_day'] is False

    def test_center_splits_location_from_organization(self):
        """'Southlake, Mann Mathematics' is one location under one brand, not one
        center name. Every location rebranded on 2025-09-05, so keeping the brand in
        centers[] splits a single location's history into three names."""
        assert parse_center('Southlake, Mann Mathematics') == {
            'centers': ['Southlake'],
            'center_orgs': ['Mann Mathematics'],
        }

    def test_a_bare_location_has_no_organization(self):
        """1,438 rows carry no brand at all."""
        assert parse_center('North Dallas') == {
            'centers': ['North Dallas'],
            'center_orgs': [],
        }

    @pytest.mark.parametrize('value,org', [
        ('Southlake, Mann Mathematics', 'Mann Mathematics'),
        ('Southlake, Math Made Simple', 'Math Made Simple'),
        ('Southlake, @Home Classroom 1', '@Home Classroom 1'),
    ])
    def test_every_organization_form_lands_in_the_same_place(self, value, org):
        """'@Home Classroom 1' names a room, not a brand, but it sits in the
        organization position and is kept there rather than special cased."""
        assert parse_center(value) == {'centers': ['Southlake'], 'center_orgs': [org]}

    def test_a_location_containing_a_comma_keeps_its_tail(self):
        """partition, not split -- only the first ', ' separates the two halves."""
        assert parse_center('Dallas, TX, Mann Mathematics') == {
            'centers': ['Dallas'],
            'center_orgs': ['TX, Mann Mathematics'],
        }

    def test_center_of_nothing(self):
        assert parse_center(None) == {'centers': [], 'center_orgs': []}

    def test_repeated_values_are_not_duplicated(self):
        parsed = parse_center('Tyler, Mann Mathematics;  Tyler, Mann Mathematics')
        assert parsed == {'centers': ['Tyler'], 'center_orgs': ['Mann Mathematics']}

    def test_lp_assignment_topics(self):
        topics = parse_lp_assignment('T-100 (Fractions): Mastered;  T-200 (Angles): Worked On')
        assert topics == [
            {'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'},
            {'id': 'T-200', 'name': 'Angles', 'status': 'Worked On'},
        ]

    def test_lp_assignment_keeps_what_it_cannot_parse(self):
        """An unrecognised entry is preserved raw rather than dropped."""
        assert parse_lp_assignment('gibberish') == [{'raw': 'gibberish'}]


class TestIsFinalized:

    def test_a_page_count_means_finalized(self):
        assert is_finalized({'pages_completed': 5}) is True

    def test_zero_pages_is_still_finalized(self):
        """0 is a recorded result -- someone completed the report and wrote zero."""
        assert is_finalized({'pages_completed': 0}) is True

    def test_no_page_count_means_unfinalized(self):
        assert is_finalized({'pages_completed': None}) is False
        assert is_finalized({}) is False

    def test_finalized_date_does_not_decide_it(self):
        """72 rows (all December 2024) carry a finalized_date with no page count, and
        547 carry pages with no finalized_date. The page count is the signal."""
        assert is_finalized({'finalized_date': '12/02/2024', 'pages_completed': None}) is False
        assert is_finalized({'finalized_date': None, 'pages_completed': 3}) is True

    def test_transform_sets_the_flag(self):
        finalized = transform_dwp_row({
            'Date': '01/02/2025', 'General Information': 'Pages Completed: 5',
        })
        unfinalized = transform_dwp_row({'Date': '01/02/2025'})
        assert finalized['finalized'] is True
        assert unfinalized['finalized'] is False

    def test_the_flag_is_inside_the_hash(self):
        """It is derived from a field already hashed, so it cannot split or merge any
        two rows -- but it does change every hash, which is why the backfill rewrites
        row_hash rather than only $set-ing the flag."""
        assert row_hash({'pages_completed': None, 'finalized': False}) != row_hash(
            {'pages_completed': None}
        )


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
            'Center': 'Tyler, Mann Mathematics',
            'LP Assignment': 'T-100 (Fractions): Mastered',
        })

        assert doc['account_id'] == 'acct-1'
        assert doc['student_name'] == 'Anthony Nguyen'
        assert doc['date'] == datetime(2025, 1, 2)
        assert doc['delivery_method'] == 'In-Center'
        assert doc['centers'] == ['Tyler']
        assert doc['center_orgs'] == ['Mann Mathematics']
        assert doc['instructors'] == ['Dana Reyes', 'Sam Ortiz']
        assert doc['pages_completed'] == 5
        assert doc['topics'] == [{'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'}]
        assert doc['row_hash']

    def test_compound_columns_do_not_survive_as_raw_fields(self):
        doc = transform_dwp_row({'Session': SESSION, 'Date': '01/02/2025'})
        assert 'session' not in doc
        assert 'Session' not in doc
