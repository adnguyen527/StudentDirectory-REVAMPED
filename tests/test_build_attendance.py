"""The attendance builder's parsing rules.

The build itself talks to a real cluster, so what is unit-tested here is the logic that
decides what a session's times mean -- which is where this data is actually messy.
"""

from datetime import time

import pytest

from ingestion.build_attendance import MAX_SESSION_MINUTES, parse_clock, session_minutes


class TestParseClock:

    @pytest.mark.parametrize('value,expected', [
        ('3:58 PM', time(15, 58)),
        ('12:00 AM', time(0, 0)),
        ('12:00 PM', time(12, 0)),
        ('9:05 am', time(9, 5)),
        ('  5:00 PM  ', time(17, 0)),
    ])
    def test_parses_clock_strings(self, value, expected):
        assert parse_clock(value) == expected

    @pytest.mark.parametrize('value', [None, '', '   '])
    def test_empty_values_are_none(self, value):
        assert parse_clock(value) is None

    def test_the_literal_string_none_is_not_a_time(self):
        """217 rows carry 'None' as session_end -- a string, not a null."""
        assert parse_clock('None') is None

    @pytest.mark.parametrize('value', ['17:00', 'lunchtime', '25:00 PM', '3:58'])
    def test_unparseable_values_are_none_not_errors(self, value):
        assert parse_clock(value) is None


class TestSessionMinutes:

    def test_measures_a_normal_session(self):
        assert session_minutes(time(15, 58), time(17, 5)) == 67

    def test_a_zero_length_session_is_zero_not_none(self):
        """Nothing to distrust here -- it is a real, if odd, measurement."""
        assert session_minutes(time(16, 0), time(16, 0)) == 0

    @pytest.mark.parametrize('start,end', [
        (None, time(17, 0)),
        (time(16, 0), None),
        (None, None),
    ])
    def test_a_missing_half_means_no_measurement(self, start, end):
        assert session_minutes(start, end) is None

    def test_an_end_before_its_start_is_rejected(self):
        """5 pairs in the data do this. It is not a length, and it is not a
        midnight crossing -- no session here runs past midnight."""
        assert session_minutes(time(17, 0), time(16, 0)) is None

    def test_an_implausibly_long_session_is_rejected(self):
        assert session_minutes(time(1, 0), time(23, 0)) is None

    def test_the_boundary_is_inclusive(self):
        assert session_minutes(time(0, 0), time(12, 0)) == MAX_SESSION_MINUTES
        assert session_minutes(time(0, 0), time(12, 1)) is None
