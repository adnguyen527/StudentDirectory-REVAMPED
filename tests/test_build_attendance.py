"""The attendance builder's timing rules.

The build itself talks to a real cluster, so what is unit-tested here is the logic that
decides what a session's times mean -- which is where this data is actually messy.

Session times reach the builder as datetimes from dwp_reports. The clock-string path is
still exercised because a build run before backfill_session_datetimes.py must produce the
same answer as one run after it.
"""

from datetime import datetime

import pytest

from ingestion.build_attendance import MAX_SESSION_MINUTES, session_minutes, session_time

DAY = datetime(2026, 3, 14)


class TestSessionTime:

    def test_a_datetime_passes_straight_through(self):
        already = datetime(2026, 3, 14, 15, 58)
        assert session_time(DAY, already) is already

    @pytest.mark.parametrize('value,expected', [
        ('3:58 PM', datetime(2026, 3, 14, 15, 58)),
        ('12:00 AM', datetime(2026, 3, 14, 0, 0)),
        ('12:00 PM', datetime(2026, 3, 14, 12, 0)),
        ('9:05 am', datetime(2026, 3, 14, 9, 5)),
        ('  5:00 PM  ', datetime(2026, 3, 14, 17, 0)),
    ])
    def test_a_clock_string_is_joined_to_the_session_date(self, value, expected):
        assert session_time(DAY, value) == expected

    @pytest.mark.parametrize('value', [None, '', '   ', 'None'])
    def test_nothing_usable_is_none(self, value):
        """217 rows have no session_end; 'None' is how the source spelled that."""
        assert session_time(DAY, value) is None

    @pytest.mark.parametrize('value', ['17:00', 'lunchtime', '25:00 PM', '3:58'])
    def test_unparseable_values_are_none_not_errors(self, value):
        assert session_time(DAY, value) is None

    def test_a_time_without_a_date_is_not_a_moment(self):
        assert session_time(None, '3:58 PM') is None


class TestSessionMinutes:

    def test_measures_a_normal_session(self):
        assert session_minutes(
            datetime(2026, 3, 14, 15, 58), datetime(2026, 3, 14, 17, 5)
        ) == 67

    def test_a_zero_length_session_is_zero_not_none(self):
        """Nothing to distrust here -- it is a real, if odd, measurement."""
        at = datetime(2026, 3, 14, 16, 0)
        assert session_minutes(at, at) == 0

    @pytest.mark.parametrize('start,end', [
        (None, datetime(2026, 3, 14, 17, 0)),
        (datetime(2026, 3, 14, 16, 0), None),
        (None, None),
    ])
    def test_a_missing_half_means_no_measurement(self, start, end):
        assert session_minutes(start, end) is None

    def test_an_end_before_its_start_is_rejected(self):
        """5 pairs in the data do this. It is not a length, and it is not a midnight
        crossing -- no session here runs past midnight."""
        assert session_minutes(
            datetime(2026, 3, 14, 17, 0), datetime(2026, 3, 14, 16, 0)
        ) is None

    def test_an_implausibly_long_session_is_rejected(self):
        assert session_minutes(
            datetime(2026, 3, 14, 1, 0), datetime(2026, 3, 14, 23, 0)
        ) is None

    def test_the_boundary_is_inclusive(self):
        midnight = datetime(2026, 3, 14, 0, 0)
        assert session_minutes(midnight, datetime(2026, 3, 14, 12, 0)) == MAX_SESSION_MINUTES
        assert session_minutes(midnight, datetime(2026, 3, 14, 12, 1)) is None

    def test_it_measures_across_the_join_the_way_the_strings_did(self):
        """The refactor must not change any answer: same two clock readings, same
        duration, whether they arrived as strings or datetimes."""
        start = session_time(DAY, '3:58 PM')
        end = session_time(DAY, '5:05 PM')
        assert session_minutes(start, end) == 67
