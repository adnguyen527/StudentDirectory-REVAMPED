"""HTTP surface, end to end over the in-memory database."""

import os
from datetime import datetime

import pytest
from bson import ObjectId

from config import DEFAULT_ORIGINS, parse_bool, parse_origins, parse_port
from models import trends
from tests.conftest import TEST_API_KEY
from tests.sample_data import (
    ACCOUNT_NGUYEN,
    ACCOUNT_TAN,
    ANTHONY_KEY,
    CHLOE_DWP_IDS,
    CHLOE_KEY,
)


def names(payload):
    return sorted(s['student_name'] for s in payload['students'])


def instructor_names(payload):
    return sorted(i['instructor_name'] for i in payload['instructors'])


def ordered_students(payload):
    """Names in the order served. Unlike names(), which sorts and so cannot see one."""
    return [s['student_name'] for s in payload['students']]


def ordered_instructors(payload):
    return [i['instructor_name'] for i in payload['instructors']]


def ordered_topics(payload):
    return [t['topic_id'] for t in payload['topics']]


class TestHealth:

    def test_health_is_ok(self, client):
        response = client.get('/api/health')
        assert response.status_code == 200
        assert response.get_json()['status'] == 'ok'


class TestListStudents:

    def test_lists_every_student(self, client):
        response = client.get('/api/students')
        assert response.status_code == 200
        assert names(response.get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]

    def test_account_id_filter_returns_the_household(self, client):
        response = client.get('/api/students', query_string={'account_id': ACCOUNT_NGUYEN})
        assert names(response.get_json()) == ['Anthony Nguyen', 'Ava Nguyen']

    def test_query_filter_searches_by_name(self, client):
        response = client.get('/api/students', query_string={'query': 'Chloe'})
        assert names(response.get_json()) == ['Chloe Tan']

    def test_account_id_wins_over_query(self, client):
        """Both params supplied: the route checks account_id first."""
        response = client.get(
            '/api/students',
            query_string={'account_id': ACCOUNT_TAN, 'query': 'Nguyen'},
        )
        assert names(response.get_json()) == ['Chloe Tan']

    def test_bson_is_serialised(self, client):
        """ObjectId and datetime must survive jsonify as $oid / $date wrappers."""
        student = next(
            s for s in client.get('/api/students').get_json()['students']
            if s['student_key'] == ANTHONY_KEY
        )
        assert '$oid' in student['_id']
        assert '$date' in student['last_session_date']

    def test_list_rows_omit_the_growing_arrays(self, client):
        """A list row is a summary. topics and instructors live on the detail view."""
        student = client.get('/api/students').get_json()['students'][0]
        assert 'topics' not in student
        assert 'instructors' not in student
        assert 'dwp_report_ids' not in student

    def test_empty_result_is_an_empty_list(self, client):
        response = client.get('/api/students', query_string={'account_id': 'nope'})
        assert response.status_code == 200
        body = response.get_json()
        assert body['students'] == []
        assert body['page']['total'] == 0


class TestCenterFilter:
    """?center= on the two list routes -- repeatable, and a union across the values."""

    def test_one_center_narrows_the_list(self, client):
        response = client.get('/api/students', query_string={'center': 'Eastside'})
        assert names(response.get_json()) == ['Chloe Tan']

    def test_two_centers_are_a_union(self, client):
        response = client.get(
            '/api/students', query_string=[('center', 'Westside'), ('center', 'Eastside')]
        )
        assert names(response.get_json()) == ['Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan']

    def test_a_center_combines_with_the_name_filter(self, client):
        """Not either/or: the two narrow together."""
        response = client.get(
            '/api/students', query_string={'query': 'Nguyen', 'center': 'Eastside'}
        )
        assert names(response.get_json()) == []

    def test_a_center_combines_with_the_account_filter(self, client):
        response = client.get(
            '/api/students',
            query_string={'account_id': ACCOUNT_NGUYEN, 'center': 'Westside'},
        )
        assert names(response.get_json()) == ['Anthony Nguyen', 'Ava Nguyen']

    def test_an_unknown_center_is_an_empty_page_not_an_error(self, client):
        """"No students at Xyz" is a correct answer to a filter, unlike a bad sort key."""
        response = client.get('/api/students', query_string={'center': 'Nowhere'})
        assert response.status_code == 200
        body = response.get_json()
        assert body['students'] == []
        assert body['page']['total'] == 0

    def test_a_blank_center_means_no_filter_at_all(self, client):
        """A truncated URL should not read as "no students here". `?query=` already
        ignores its own empty value, and the two have to agree."""
        response = client.get('/api/students', query_string={'center': ''})
        assert names(response.get_json()) == ['Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan']

    def test_a_blank_center_beside_a_real_one_is_ignored(self, client):
        response = client.get(
            '/api/students', query_string=[('center', ''), ('center', 'Eastside')]
        )
        assert names(response.get_json()) == ['Chloe Tan']

    def test_the_total_follows_the_center_filter(self, client):
        body = client.get(
            '/api/students', query_string={'center': 'Westside', 'limit': 1}
        ).get_json()
        assert body['page']['total'] == 2
        assert body['page']['returned'] == 1

    def test_instructors_filter_by_center_too(self, client):
        assert instructor_names(
            client.get('/api/instructors', query_string={'center': 'Eastside'}).get_json()
        ) == ['Dana Reyes', 'Sam Ortiz']

    def test_an_instructor_at_two_centers_is_returned_once(self, client):
        """The union is not a partition. Dana works at both, and 11 of the 103 real
        instructors do the same -- ticking both centers must not count her twice."""
        body = client.get(
            '/api/instructors',
            query_string=[('center', 'Westside'), ('center', 'Eastside')],
        ).get_json()
        assert instructor_names(body) == ['Dana Reyes', 'Marcus Reyes', 'Sam Ortiz']
        assert body['page']['total'] == 3


class TestSortStudents:
    """?sort= and ?direction= on the student list.

    The fixture is built for this: Ava and Chloe both have one session, so every sort by
    a count has a tie in it, which is where a paged sort goes wrong if the order is not
    total. Ava's student_key sorts before Chloe's, so the tie-break is visible.
    """

    def test_sorts_by_a_count_largest_first(self, client):
        response = client.get('/api/students?sort=sessions')
        assert response.status_code == 200
        assert ordered_students(response.get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]

    def test_reverses_on_request(self, client):
        response = client.get('/api/students?sort=sessions&direction=asc')
        # The tied pair keeps its tie-break order; only the sorted column flips.
        assert ordered_students(response.get_json()) == [
            'Ava Nguyen', 'Chloe Tan', 'Anthony Nguyen'
        ]

    def test_a_name_sorts_a_to_z_first_though_a_count_sorts_largest_first(self, client):
        # The default direction is a property of the column, not of the endpoint: "first"
        # means A for a name and most for a count.
        assert ordered_students(client.get('/api/students?sort=name').get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]
        assert ordered_students(client.get('/api/students?sort=name&direction=desc')
                                .get_json()) == [
            'Chloe Tan', 'Ava Nguyen', 'Anthony Nguyen'
        ]

    def test_sorts_by_date(self, client):
        assert ordered_students(client.get('/api/students?sort=last_session').get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]

    def test_pages_a_tied_sort_without_repeating_or_dropping_a_row(self, client):
        # The reason every order ends in the unique key. Two students tie on sessions, and
        # an unstable tie can serve one of them on both pages and the other on neither.
        seen = []
        for offset in range(3):
            page = client.get(
                f'/api/students?sort=sessions&direction=asc&limit=1&offset={offset}'
            ).get_json()
            seen += ordered_students(page)
        assert seen == ['Ava Nguyen', 'Chloe Tan', 'Anthony Nguyen']
        assert len(set(seen)) == 3

    def test_sorts_within_a_filter_rather_than_instead_of_it(self, client):
        response = client.get('/api/students?center=Westside&sort=sessions&direction=asc')
        payload = response.get_json()
        assert payload['page']['total'] == 2
        assert ordered_students(payload) == ['Ava Nguyen', 'Anthony Nguyen']

    def test_sorts_a_search_result(self, client):
        response = client.get('/api/students?query=Nguyen&sort=sessions&direction=asc')
        assert ordered_students(response.get_json()) == ['Ava Nguyen', 'Anthony Nguyen']

    def test_sorts_one_household(self, client):
        response = client.get(
            f'/api/students?account_id={ACCOUNT_NGUYEN}&sort=sessions&direction=asc'
        )
        assert ordered_students(response.get_json()) == ['Ava Nguyen', 'Anthony Nguyen']

    def test_the_account_column_does_not_sort(self, client):
        # Shown, but not orderable: an account id is an opaque 36-character handle
        # displayed eight characters at a time, so sorting by it arranges households by a
        # string nobody reads. The question it does answer is ?account_id=.
        response = client.get('/api/students?sort=account')
        assert response.status_code == 400

    def test_refuses_a_column_that_does_not_exist(self, client):
        # Deliberately unlike an unknown center, which correctly returns an empty page:
        # there is no correct list to serve for a column nobody has.
        response = client.get('/api/students?sort=bogus')
        assert response.status_code == 400
        assert 'sessions' in response.get_json()['error']

    def test_refuses_a_direction_that_is_not_one(self, client):
        response = client.get('/api/students?sort=sessions&direction=sideways')
        assert response.status_code == 400

    def test_ignores_a_direction_with_nothing_to_direct(self, client):
        # ?direction= alone sorts nothing, which is unambiguous rather than wrong.
        response = client.get('/api/students?direction=desc')
        assert response.status_code == 200
        assert ordered_students(response.get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]

    def test_blank_values_are_the_default_order(self, client):
        # A truncated URL, as `?center=` and `?query=` already handle.
        response = client.get('/api/students?sort=&direction=')
        assert response.status_code == 200
        assert ordered_students(response.get_json()) == [
            'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]


class TestRangeFilters:
    """The `?<column>_min=` family on the three list routes.

    Both ends are inclusive, several columns narrow together, and they narrow *with* the
    name and center filters rather than replacing them.
    """

    def test_a_minimum_keeps_the_row_that_equals_it(self, client):
        # "5 or more" is what a person means by a minimum of 5, so the bound is inclusive.
        # Anthony has 2 sessions; Ava and Chloe have 1.
        assert names(client.get('/api/students?sessions_min=2').get_json()) == [
            'Anthony Nguyen'
        ]
        assert names(client.get('/api/students?sessions_max=1').get_json()) == [
            'Ava Nguyen', 'Chloe Tan'
        ]

    def test_both_ends_at_once(self, client):
        payload = client.get('/api/students?sessions_min=1&sessions_max=1').get_json()
        assert names(payload) == ['Ava Nguyen', 'Chloe Tan']
        assert payload['page']['total'] == 2

    def test_two_columns_narrow_together(self, client):
        # Anthony is the only student with 2 sessions, and he has 2 topics finished.
        assert names(
            client.get('/api/students?sessions_min=2&finished_min=2').get_json()
        ) == ['Anthony Nguyen']
        assert names(
            client.get('/api/students?sessions_min=2&finished_max=1').get_json()
        ) == []

    def test_a_date_range_includes_both_days(self, client):
        # Anthony 3/14, Ava 3/10, Chloe 2/1 -- and the dates are stored at midnight, so
        # an inclusive end has to cover the day it names rather than stopping before it.
        assert names(
            client.get('/api/students?last_session_from=2026-03-10').get_json()
        ) == ['Anthony Nguyen', 'Ava Nguyen']
        assert names(
            client.get('/api/students?last_session_to=2026-03-10').get_json()
        ) == ['Ava Nguyen', 'Chloe Tan']
        assert names(
            client.get(
                '/api/students?last_session_from=2026-03-10&last_session_to=2026-03-14'
            ).get_json()
        ) == ['Anthony Nguyen', 'Ava Nguyen']

    def test_ranges_narrow_with_the_other_filters_rather_than_replacing_them(self, client):
        payload = client.get(
            '/api/students?query=Nguyen&center=Westside&sessions_min=2'
        ).get_json()
        assert names(payload) == ['Anthony Nguyen']

    def test_ranges_survive_a_sort(self, client):
        payload = client.get(
            '/api/students?sessions_max=1&sort=name&direction=desc'
        ).get_json()
        assert ordered_students(payload) == ['Chloe Tan', 'Ava Nguyen']

    def test_a_blank_bound_is_no_filter(self, client):
        # A truncated URL, as `?center=` and `?sort=` already handle.
        payload = client.get('/api/students?sessions_min=&last_session_from=').get_json()
        assert payload['page']['total'] == 3

    def test_refuses_a_bound_that_is_not_a_number(self, client):
        response = client.get('/api/students?sessions_min=lots')
        assert response.status_code == 400
        assert 'sessions_min' in response.get_json()['error']

    def test_refuses_a_date_that_is_not_one(self, client):
        response = client.get('/api/students?last_session_from=last%20June')
        assert response.status_code == 400
        assert 'YYYY-MM-DD' in response.get_json()['error']

    def test_refuses_a_range_that_runs_backwards(self, client):
        # An empty page would also be defensible -- nothing is between 10 and 5 -- but
        # every way of producing that pair is a mistake.
        response = client.get('/api/students?sessions_min=10&sessions_max=5')
        assert response.status_code == 400
        assert 'must not be greater than' in response.get_json()['error']

    def test_ignores_a_column_it_does_not_filter(self, client):
        # Unlike ?sort=bogus: a parameter nobody declared is not a wrong answer, it is a
        # parameter this route does not read -- and pages_min is a real field on the
        # document that deliberately has no filter.
        assert client.get('/api/students?pages_min=500').get_json()['page']['total'] == 3

    def test_filters_a_household(self, client):
        payload = client.get(
            f'/api/students?account_id={ACCOUNT_NGUYEN}&sessions_min=2'
        ).get_json()
        assert names(payload) == ['Anthony Nguyen']

    def test_filters_instructors_by_their_own_columns(self, client):
        assert instructor_names(
            client.get('/api/instructors?sessions_min=3').get_json()
        ) == ['Dana Reyes']

    def test_instructors_do_not_filter_by_a_derived_count(self, client):
        # Students and Days sort but do not filter: they are $size of arrays, so a range
        # on them would have to size every document in the collection to match one.
        assert client.get('/api/instructors?students_min=2').get_json()['page']['total'] == 3

    def test_filters_topics_by_their_own_columns(self, client):
        # Fractions has 3 sessions and Decimals 2; the other two have 1 each.
        payload = client.get('/api/topics?sessions_min=2&sessions_max=4').get_json()
        assert ordered_topics(payload) == ['T-100', 'T-110']

    def test_a_median_bound_drops_the_topics_that_have_no_median(self, client):
        # T-115 has never been finished, so its median is null and no range can match it.
        # Right, but worth pinning: it is why the popover has to say so.
        payload = client.get('/api/topics?median_min=0').get_json()
        assert 'T-115' not in ordered_topics(payload)
        assert payload['page']['total'] == 3


class TestCenters:

    def test_lists_every_center_across_both_collections(self, client):
        response = client.get('/api/centers')
        assert response.status_code == 200
        assert response.get_json() == {'centers': ['Eastside', 'Westside']}

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/centers').status_code == 401


class TestCenterMetrics:
    """GET /api/centers/metrics -- the center dashboard's stat tiles."""

    def totals(self, client, *centers):
        response = client.get('/api/centers/metrics',
                              query_string=[('center', c) for c in centers])
        assert response.status_code == 200
        return response.get_json()['totals']

    def test_pages_are_the_pages_recorded_not_the_pages_credited(self, client):
        """⚠️ The assertion this whole route exists for.

        Anthony's 3/14 session was co-taught, so Dana and Marcus are each credited its
        full 7 pages. Summing what the instructors collection holds for Westside gives
        16 + 7 = 23. Only 16 pages were actually turned. Read from dwp_reports, which is
        the one place a session is counted once.
        """
        assert self.totals(client, 'Westside')['pages_completed'] == 16

    def test_siblings_count_as_two_students(self, client):
        """Anthony and Ava share an account. An account is a household, not a student."""
        assert self.totals(client, 'Westside')['students'] == 2

    def test_counts_sessions_instructors_and_days(self, client):
        totals = self.totals(client, 'Westside')
        assert (totals['sessions'], totals['instructors'], totals['days']) == (3, 2, 3)

    def test_reports_the_span_of_the_sessions_it_counted(self, client):
        totals = self.totals(client, 'Westside')
        assert totals['first_session']['$date'].startswith('2026-03-07')
        assert totals['last_session']['$date'].startswith('2026-03-14')

    def test_no_center_given_is_every_center(self, client):
        """An absent filter and a filter on everything are the same question."""
        totals = self.totals(client)
        assert totals['sessions'] == 4
        assert totals['students'] == 3
        assert totals['instructors'] == 3
        assert totals['pages_completed'] == 23

    def test_a_blank_center_is_ignored_rather_than_matched(self, client):
        """A truncated URL means no filter, as it does on every list route."""
        assert self.totals(client, '') == self.totals(client)

    def test_an_instructor_at_two_selected_centers_counts_once(self, client, seeded_db):
        """11 of 103 instructors work at more than one center, and are still one person.

        The shared fixtures give Dana no Eastside session, so one is added here rather
        than changing counts that the rest of this file asserts.
        """
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_TAN,
            'student_name': 'Chloe Tan',
            'date': datetime(2026, 2, 8),
            'centers': ['Eastside'],
            'instructors': ['Dana Reyes'],
            'pages_completed': 3,
        })

        both = self.totals(client, 'Westside', 'Eastside')
        assert both['instructors'] == 3          # Dana, Marcus, Sam -- not 4
        assert self.totals(client, 'Westside')['instructors'] == 2
        assert self.totals(client, 'Eastside')['instructors'] == 2

    def test_a_report_with_no_finalized_flag_counts_as_outstanding(self, client):
        """The follow-up queue errs towards showing work, not towards looking clean."""
        assert self.totals(client, 'Westside')['unfinalized'] == 3

    def test_a_finalized_report_leaves_the_outstanding_count(self, client, seeded_db):
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_NGUYEN,
            'student_name': 'Anthony Nguyen',
            'date': datetime(2026, 3, 21),
            'centers': ['Westside'],
            'instructors': ['Dana Reyes'],
            'pages_completed': 2,
            'finalized': True,
        })

        totals = self.totals(client, 'Westside')
        assert totals['sessions'] == 4
        assert totals['unfinalized'] == 3

    def test_an_unknown_center_is_zeroes_and_not_an_error(self, client):
        """"Nothing happened at Xyz" is a correct answer. `sort=bogus` has none."""
        assert self.totals(client, 'Nowhere') == {
            'sessions': 0, 'students': 0, 'instructors': 0, 'pages_completed': 0,
            'unfinalized': 0, 'days': 0, 'first_session': None, 'last_session': None,
        }

    def test_echoes_the_selection_it_answered(self, client):
        body = client.get('/api/centers/metrics',
                          query_string=[('center', 'Westside'), ('center', '')]).get_json()
        assert body['centers'] == ['Westside']

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/centers/metrics').status_code == 401


class TestSearchStudents:

    def test_search_returns_matches(self, client):
        response = client.get('/api/students/search', query_string={'q': 'Nguyen'})
        assert response.status_code == 200
        assert names(response.get_json()) == ['Anthony Nguyen', 'Ava Nguyen']

    @pytest.mark.parametrize('params', [{}, {'q': ''}, {'q': 'a'}])
    def test_short_or_missing_query_is_rejected(self, client, params):
        response = client.get('/api/students/search', query_string=params)
        assert response.status_code == 400
        assert 'error' in response.get_json()

    def test_regex_metacharacters_do_not_error(self, client):
        response = client.get('/api/students/search', query_string={'q': '(('})
        assert response.status_code == 200
        assert response.get_json()['students'] == []

    def test_search_pages_too(self, client):
        """A search page hitting this on every keystroke is what pagination is for."""
        body = client.get(
            '/api/students/search', query_string={'q': 'Nguyen', 'limit': 1}
        ).get_json()
        assert len(body['students']) == 1
        assert body['page']['total'] == 2

    def test_a_bad_limit_is_rejected_before_the_query_runs(self, client):
        response = client.get(
            '/api/students/search', query_string={'q': 'Nguyen', 'limit': 'lots'}
        )
        assert response.status_code == 400


class TestPagination:
    """?limit= and ?offset= on the list routes -- see routes/pagination.py."""

    def test_no_params_returns_the_default_page(self, client):
        page = client.get('/api/students').get_json()['page']
        assert page == {'limit': 50, 'offset': 0, 'total': 3, 'returned': 3}

    def test_limit_takes_the_first_n(self, client):
        body = client.get('/api/students', query_string={'limit': 2}).get_json()
        assert names(body) == ['Anthony Nguyen', 'Ava Nguyen']
        assert body['page'] == {'limit': 2, 'offset': 0, 'total': 3, 'returned': 2}

    def test_offset_walks_past_them(self, client):
        body = client.get(
            '/api/students', query_string={'limit': 2, 'offset': 2}
        ).get_json()
        assert names(body) == ['Chloe Tan']
        assert body['page']['returned'] == 1

    def test_the_total_is_the_whole_match_not_the_page(self, client):
        """What a pager needs on the first request, without walking to the end."""
        body = client.get('/api/students', query_string={'limit': 1}).get_json()
        assert body['page']['total'] == 3
        assert body['page']['returned'] == 1

    def test_the_total_follows_the_filter(self, client):
        body = client.get(
            '/api/students', query_string={'query': 'Nguyen', 'limit': 1}
        ).get_json()
        assert body['page']['total'] == 2

    def test_offset_past_the_end_is_an_empty_page(self, client):
        body = client.get('/api/students', query_string={'offset': 500}).get_json()
        assert body['students'] == []
        assert body['page']['total'] == 3

    def test_an_oversized_limit_is_capped_not_refused(self, client):
        """A caller asking for everything gets a page and a total telling it there is
        more -- more useful than a 400 it has to learn about first."""
        body = client.get('/api/students', query_string={'limit': 10_000}).get_json()
        assert body['page']['limit'] == 200

    def test_limit_zero_is_refused(self, client):
        """pymongo reads .limit(0) as 'no limit', so accepting it would return all."""
        response = client.get('/api/students', query_string={'limit': 0})
        assert response.status_code == 400
        assert 'error' in response.get_json()

    @pytest.mark.parametrize('params', [
        {'limit': 'ten'}, {'limit': '-1'}, {'limit': '1.5'},
        {'offset': 'later'}, {'offset': '-1'},
    ])
    def test_junk_paging_params_are_rejected(self, client, params):
        response = client.get('/api/students', query_string=params)
        assert response.status_code == 400
        assert 'error' in response.get_json()

    @pytest.mark.parametrize('params', [{'limit': ''}, {'offset': ''}])
    def test_blank_paging_params_fall_back_to_the_defaults(self, client, params):
        """An empty input box on the frontend should not be a 400."""
        response = client.get('/api/students', query_string=params)
        assert response.status_code == 200
        assert response.get_json()['page']['limit'] == 50

    def test_walking_pages_visits_each_student_once(self, client):
        """The point of sorting: skip/limit over an unsorted cursor can repeat a row."""
        walked = []
        offset = 0
        while True:
            body = client.get(
                '/api/students', query_string={'limit': 1, 'offset': offset}
            ).get_json()
            if not body['students']:
                break
            walked.append(body['students'][0]['student_key'])
            offset += 1
        assert len(walked) == len(set(walked)) == 3

    def test_instructors_page_in_the_same_envelope(self, client):
        body = client.get('/api/instructors', query_string={'limit': 2}).get_json()
        assert instructor_names(body) == ['Dana Reyes', 'Marcus Reyes']
        assert body['page'] == {'limit': 2, 'offset': 0, 'total': 3, 'returned': 2}


class TestGetStudent:

    def test_returns_the_student_with_their_own_reports(self, client):
        response = client.get(f'/api/students/{ANTHONY_KEY}')
        assert response.status_code == 200

        body = response.get_json()
        assert body['student']['student_name'] == 'Anthony Nguyen'
        assert body['stats']['total_dwp_reports'] == 2
        assert {r['student_name'] for r in body['dwp_reports']} == {'Anthony Nguyen'}

    def test_reports_exclude_siblings(self, client):
        """Anthony's household has 3 sessions; only 2 are his."""
        body = client.get(f'/api/students/{ANTHONY_KEY}').get_json()
        assert body['stats']['total_dwp_reports'] == 2

    def test_reports_are_newest_first(self, client):
        reports = client.get(f'/api/students/{ANTHONY_KEY}').get_json()['dwp_reports']
        dates = [r['date']['$date'] for r in reports]
        assert dates == sorted(dates, reverse=True)

    def test_student_with_a_single_report(self, client):
        body = client.get(f'/api/students/{CHLOE_KEY}').get_json()
        assert body['stats']['total_dwp_reports'] == 1

    @pytest.mark.parametrize('field', [
        'row_hash',
        'lead_id',
        'internal_notes',
        'notes_from_center_director',
        'notes_for_center_director',
    ])
    def test_private_fields_are_not_served(self, client, field):
        """End-to-end: whatever the model withholds must not reappear over HTTP."""
        body = client.get(f'/api/students/{CHLOE_KEY}').get_json()
        assert body['dwp_reports'], 'no reports -- the assertion below is vacuous'
        assert all(field not in report for report in body['dwp_reports'])

    def test_the_response_is_not_empty_of_everything(self, client):
        """Guards the guard: a projection that withheld the whole document would make
        every leak assertion above pass for the wrong reason."""
        report = client.get(f'/api/students/{CHLOE_KEY}').get_json()['dwp_reports'][0]
        assert report['session_summary_notes'] == 'worked through angle pairs'
        assert report['pages_completed'] == 7

    def test_unknown_student_is_404(self, client):
        response = client.get('/api/students/no-such-account_nobody')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Student not found'}


class TestStudentAttendance:
    """GET /api/students/<key>/attendance -- what a manager reads to a parent."""

    def url(self, key, start='2026-03-01', end='2026-03-31'):
        return f'/api/students/{key}/attendance?start={start}&end={end}'

    def test_returns_sessions_days_and_the_dates(self, client):
        body = client.get(self.url(ANTHONY_KEY)).get_json()

        assert body['student']['student_name'] == 'Anthony Nguyen'
        assert body['period'] == {'start': '2026-03-01', 'end': '2026-03-31'}
        assert body['totals'] == {'sessions': 3, 'days': 2}
        assert body['by_month'] == [{'month': '2026-03', 'sessions': 3, 'days': 2}]
        assert len(body['visits']) == 2

    def test_the_dates_are_present_and_chronological(self, client):
        """The dates are the substance of the conversation, not just the total."""
        visits = client.get(self.url(ANTHONY_KEY)).get_json()['visits']
        dates = [v['date']['$date'] for v in visits]
        assert dates == sorted(dates)

    def test_a_student_with_no_sessions_in_the_period_is_a_zero_not_a_404(self, client):
        """'Zero this period' is the answer the manager is calling about."""
        response = client.get(self.url(ANTHONY_KEY, '2026-05-01', '2026-05-31'))
        assert response.status_code == 200
        body = response.get_json()
        assert body['totals'] == {'sessions': 0, 'days': 0}
        assert body['by_month'] == []
        assert body['visits'] == []

    def test_an_unknown_student_is_a_404(self, client):
        response = client.get(self.url('no-such-account_nobody'))
        assert response.status_code == 404

    def test_siblings_are_not_mixed_in(self, client):
        """Ava attended on 3/10 and shares Anthony's account."""
        visits = client.get(self.url(ANTHONY_KEY)).get_json()['visits']
        assert {v['student_name'] for v in visits} == {'Anthony Nguyen'}

    @pytest.mark.parametrize('params', [
        '',
        '?start=2026-03-01',
        '?end=2026-03-31',
        '?start=2026-03-01&end=notadate',
        '?start=03/01/2026&end=03/31/2026',
    ])
    def test_a_missing_or_malformed_period_is_rejected(self, client, params):
        response = client.get(f'/api/students/{ANTHONY_KEY}/attendance{params}')
        assert response.status_code == 400
        assert 'error' in response.get_json()

    def test_a_backwards_period_is_rejected(self, client):
        response = client.get(self.url(ANTHONY_KEY, '2026-03-31', '2026-03-01'))
        assert response.status_code == 400
        assert 'after end' in response.get_json()['error']

    def test_there_is_no_default_period(self, client):
        """A 'this month' default would silently return nothing whenever the imported
        data lags the calendar, which reads as a broken endpoint."""
        assert client.get(f'/api/students/{ANTHONY_KEY}/attendance').status_code == 400

    def test_private_fields_are_not_served_here_either(self, client):
        visits = client.get(self.url(CHLOE_KEY, '2026-02-01', '2026-02-28')).get_json()['visits']
        assert visits, 'no visits -- the assertion below is vacuous'
        assert all('dwp_report_ids' not in v for v in visits)

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get(self.url(ANTHONY_KEY)).status_code == 401


class TestListInstructors:

    def test_lists_every_instructor(self, client):
        response = client.get('/api/instructors')
        assert response.status_code == 200
        assert instructor_names(response.get_json()) == [
            'Dana Reyes', 'Marcus Reyes', 'Sam Ortiz'
        ]

    def test_query_filter_searches_by_name(self, client):
        response = client.get('/api/instructors', query_string={'query': 'Ortiz'})
        assert instructor_names(response.get_json()) == ['Sam Ortiz']

    def test_the_growing_arrays_are_not_shipped_in_a_list(self, client):
        """A roster per row is what makes a list response balloon."""
        listed = client.get('/api/instructors').get_json()['instructors']
        assert all('students' not in i and 'days_taught' not in i for i in listed)
        assert all(i['unique_students'] >= 1 for i in listed)

    def test_bson_is_serialised(self, client):
        dana = next(
            i for i in client.get('/api/instructors').get_json()['instructors']
            if i['instructor_name'] == 'Dana Reyes'
        )
        assert '$oid' in dana['_id']
        assert '$date' in dana['last_session_date']

    def test_empty_result_is_an_empty_list(self, client):
        response = client.get('/api/instructors', query_string={'query': 'nobody'})
        assert response.status_code == 200
        body = response.get_json()
        assert body['instructors'] == []
        assert body['page']['total'] == 0


class TestSortInstructors:

    def test_sorts_by_a_stored_count(self, client):
        response = client.get('/api/instructors?sort=sessions')
        assert ordered_instructors(response.get_json()) == [
            'Dana Reyes', 'Marcus Reyes', 'Sam Ortiz'
        ]

    def test_sorts_by_a_count_derived_from_an_array_it_does_not_ship(self, client):
        # Students and Days are $size of arrays the list projection removes, so sorting
        # by them moves $addFields ahead of $sort. The count still has to arrive, and the
        # array still has to not.
        payload = client.get('/api/instructors?sort=students').get_json()
        assert ordered_instructors(payload) == ['Dana Reyes', 'Marcus Reyes', 'Sam Ortiz']
        assert payload['instructors'][0]['unique_students'] == 2
        assert 'students' not in payload['instructors'][0]

    def test_sorts_by_days_taught_in_both_directions(self, client):
        assert ordered_instructors(
            client.get('/api/instructors?sort=days&direction=asc').get_json()
        ) == ['Marcus Reyes', 'Sam Ortiz', 'Dana Reyes']

    def test_sorts_within_a_center_filter(self, client):
        payload = client.get(
            '/api/instructors?center=Westside&sort=sessions&direction=asc'
        ).get_json()
        assert ordered_instructors(payload) == ['Marcus Reyes', 'Dana Reyes']

    def test_refuses_a_column_that_does_not_exist(self, client):
        assert client.get('/api/instructors?sort=bogus').status_code == 400


class TestSearchInstructors:

    def test_search_returns_matches(self, client):
        response = client.get('/api/instructors/search', query_string={'q': 'Reyes'})
        assert response.status_code == 200
        assert instructor_names(response.get_json()) == ['Dana Reyes', 'Marcus Reyes']

    @pytest.mark.parametrize('params', [{}, {'q': ''}, {'q': 'a'}])
    def test_short_or_missing_query_is_rejected(self, client, params):
        response = client.get('/api/instructors/search', query_string=params)
        assert response.status_code == 400
        assert 'error' in response.get_json()

    def test_regex_metacharacters_do_not_error(self, client):
        response = client.get('/api/instructors/search', query_string={'q': '(('})
        assert response.status_code == 200
        assert response.get_json()['instructors'] == []

    def test_search_pages_too(self, client):
        body = client.get(
            '/api/instructors/search', query_string={'q': 'Reyes', 'limit': 1}
        ).get_json()
        assert len(body['instructors']) == 1
        assert body['page']['total'] == 2


class TestGetInstructor:

    def test_returns_the_instructor_with_roster_and_days(self, client):
        response = client.get('/api/instructors/Dana Reyes')
        assert response.status_code == 200

        instructor = response.get_json()['instructor']
        assert instructor['total_sessions_taught'] == 3
        assert instructor['co_taught_sessions'] == 1
        assert len(instructor['days_taught']) == 3
        assert [s['student_name'] for s in instructor['students']] == [
            'Anthony Nguyen', 'Ava Nguyen'
        ]

    def test_a_name_with_a_space_survives_url_encoding(self, client):
        """The key is a human name, so every lookup goes through percent-encoding."""
        response = client.get('/api/instructors/Marcus%20Reyes')
        assert response.status_code == 200
        assert response.get_json()['instructor']['instructor_name'] == 'Marcus Reyes'

    def test_the_roster_links_to_students_that_exist(self, client):
        """student_key is the join back to the student profile page."""
        roster = client.get('/api/instructors/Sam Ortiz').get_json()['instructor']['students']
        assert roster[0]['student_key'] == CHLOE_KEY
        assert client.get(f'/api/students/{CHLOE_KEY}').status_code == 200

    def test_unknown_instructor_is_404(self, client):
        response = client.get('/api/instructors/Nobody At All')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Instructor not found'}

    def test_a_partial_name_is_404_not_a_lucky_match(self, client):
        assert client.get('/api/instructors/Dana').status_code == 404

    def test_search_is_not_shadowed_by_the_name_route(self, client):
        """/instructors/search would otherwise read as an instructor called 'search'."""
        response = client.get('/api/instructors/search', query_string={'q': 'Reyes'})
        assert response.status_code == 200
        # A search page, not the single-instructor envelope the name route returns.
        assert 'instructors' in response.get_json()
        assert 'instructor' not in response.get_json()

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/instructors/Dana Reyes').status_code == 401


def topic_ids(payload):
    return [t['topic_id'] for t in payload['topics']]


class TestListTopics:

    def test_lists_every_topic(self, client):
        response = client.get('/api/topics')
        assert response.status_code == 200
        assert sorted(topic_ids(response.get_json())) == [
            'T-100', 'T-110', 'T-115', 'T-200'
        ]

    def test_most_worked_topics_come_first(self, client):
        """The top of a 771-row list should be what the program spends its time on.
        T-115 and T-200 both have one session, so the id settles which comes first."""
        assert topic_ids(client.get('/api/topics').get_json()) == [
            'T-100', 'T-110', 'T-115', 'T-200'
        ]

    def test_paging_across_a_session_tie_never_repeats_a_row(self, client):
        """Session counts tie constantly -- 670 of the 771 real topics share theirs --
        so sorting on sessions alone lets one row answer two pages. That is the bug the
        compound sort exists to stop."""
        seen = []
        for offset in range(0, 4):
            page = client.get(
                '/api/topics', query_string={'limit': 1, 'offset': offset}
            ).get_json()
            seen.extend(topic_ids(page))
        assert seen == ['T-100', 'T-110', 'T-115', 'T-200']
        assert len(set(seen)) == 4

    def test_query_filter_searches_by_name(self, client):
        response = client.get('/api/topics', query_string={'query': 'Angles'})
        assert topic_ids(response.get_json()) == ['T-200']

    def test_the_instructor_ranking_is_not_shipped_in_a_list(self, client):
        """82 instructors on the widest topic -- the array that balloons a list page.
        Nothing stands in for it: the list has no instructor column to fill."""
        listed = client.get('/api/topics').get_json()['topics']
        assert listed
        assert all('instructors' not in t for t in listed)

    def test_bson_is_serialised(self, client):
        fractions = next(
            t for t in client.get('/api/topics').get_json()['topics']
            if t['topic_id'] == 'T-100'
        )
        assert '$oid' in fractions['_id']
        assert '$date' in fractions['last_taught']

    def test_empty_result_is_an_empty_list(self, client):
        body = client.get('/api/topics', query_string={'query': 'nothing'}).get_json()
        assert body['topics'] == []
        assert body['page']['total'] == 0


class TestSortTopics:
    """?sort= on topics, where one sortable column is null on rows that have no value.

    T-115 has never been finished by anyone, so its median is null -- the same shape as
    the 109 of 771 topics in the real data.
    """

    def test_sorts_by_a_count(self, client):
        assert ordered_topics(client.get('/api/topics?sort=students').get_json()) == [
            'T-100', 'T-110', 'T-115', 'T-200'
        ]

    def test_breaks_a_name_tie_on_the_id(self, client):
        # Two topics are called Decimals, as 90 names are in the real data.
        assert ordered_topics(client.get('/api/topics?sort=name').get_json()) == [
            'T-200', 'T-110', 'T-115', 'T-100'
        ]

    def test_keeps_topics_with_no_median_at_the_bottom_either_way(self, client):
        # Null sorts below every number in Mongo, so an ascending median would otherwise
        # open the list with the rows that have nothing to say about it.
        assert ordered_topics(
            client.get('/api/topics?sort=median&direction=asc').get_json()
        ) == ['T-200', 'T-100', 'T-110', 'T-115']
        assert ordered_topics(
            client.get('/api/topics?sort=median&direction=desc').get_json()
        ) == ['T-110', 'T-100', 'T-200', 'T-115']

    def test_the_null_sort_still_hides_the_instructor_roster(self, client):
        # That path builds its own pipeline, so it has its own chance to leak the array
        # the list projection exists to remove.
        payload = client.get('/api/topics?sort=median').get_json()
        assert 'instructors' not in payload['topics'][0]
        assert '_missing' not in payload['topics'][0]

    def test_pages_the_null_sort_without_repeating_a_row(self, client):
        seen = []
        for offset in range(4):
            seen += ordered_topics(
                client.get(f'/api/topics?sort=median&limit=1&offset={offset}').get_json()
            )
        assert seen == ['T-110', 'T-100', 'T-200', 'T-115']

    def test_sorts_a_search_result(self, client):
        payload = client.get(
            '/api/topics?query=Decimals&sort=sessions&direction=asc'
        ).get_json()
        assert ordered_topics(payload) == ['T-115', 'T-110']

    def test_refuses_a_column_that_does_not_exist(self, client):
        assert client.get('/api/topics?sort=bogus').status_code == 400


class TestSearchTopics:

    def test_search_returns_matches(self, client):
        response = client.get('/api/topics/search', query_string={'q': 'Decimals'})
        assert response.status_code == 200
        assert topic_ids(response.get_json()) == ['T-110', 'T-115']

    def test_a_former_name_still_finds_the_topic(self, client):
        """T-100 is called Fractions now; the source also called it Halves and Quarters.
        Finding it by the old name is the whole reason also_known_as is stored."""
        response = client.get('/api/topics/search', query_string={'q': 'Halves'})
        assert response.status_code == 200
        assert topic_ids(response.get_json()) == ['T-100']

    def test_an_id_finds_its_topic(self, client):
        """The id is a handle staff use, and it is what the list shows to tell topics
        with the same name apart -- so it has to be searchable."""
        response = client.get('/api/topics/search', query_string={'q': 'T-200'})
        assert topic_ids(response.get_json()) == ['T-200']

    def test_an_id_search_is_case_insensitive(self, client):
        assert topic_ids(
            client.get('/api/topics/search', query_string={'q': 't-200'}).get_json()
        ) == ['T-200']

    def test_a_partial_id_matches_every_topic_under_it(self, client):
        """'T-1' is how someone reaches for a family of ids rather than one topic.
        Sorted here because the rows come back in name order, which the list tests own."""
        assert sorted(topic_ids(
            client.get('/api/topics/search', query_string={'q': 'T-1'}).get_json()
        )) == ['T-100', 'T-110', 'T-115']

    @pytest.mark.parametrize('params', [{}, {'q': ''}, {'q': 'a'}])
    def test_short_or_missing_query_is_rejected(self, client, params):
        response = client.get('/api/topics/search', query_string=params)
        assert response.status_code == 400
        assert 'error' in response.get_json()

    def test_regex_metacharacters_do_not_error(self, client):
        response = client.get('/api/topics/search', query_string={'q': '(('})
        assert response.status_code == 200
        assert response.get_json()['topics'] == []

    def test_search_pages_too(self, client):
        body = client.get(
            '/api/topics/search', query_string={'q': 'Decimals', 'limit': 1}
        ).get_json()
        assert len(body['topics']) == 1
        assert body['page']['total'] == 2

    def test_search_is_not_shadowed_by_the_id_route(self, client):
        """/topics/search would otherwise read as a topic whose id is 'search'."""
        response = client.get('/api/topics/search', query_string={'q': 'Decimals'})
        assert response.status_code == 200
        assert 'topics' in response.get_json()
        assert 'topic' not in response.get_json()


class TestGetTopic:

    def test_returns_the_topic_with_its_instructor_ranking(self, client):
        response = client.get('/api/topics/T-100')
        assert response.status_code == 200

        topic = response.get_json()['topic']
        assert topic['name'] == 'Fractions'
        assert topic['unique_students'] == 2
        assert [i['name'] for i in topic['instructors']] == [
            'Dana Reyes', 'Marcus Reyes'
        ]

    def test_the_names_it_no_longer_goes_by_come_with_it(self, client):
        topic = client.get('/api/topics/T-100').get_json()['topic']
        assert topic['also_known_as'] == ['Halves and Quarters']

    def test_the_ranking_links_to_instructors_that_exist(self, client):
        """The instructor name is the join back to the profile page."""
        topic = client.get('/api/topics/T-200').get_json()['topic']
        assert client.get(f"/api/instructors/{topic['instructors'][0]['name']}") \
            .status_code == 200

    def test_a_topic_nobody_was_recorded_teaching_still_resolves(self, client):
        topic = client.get('/api/topics/T-115').get_json()['topic']
        assert topic['instructors'] == []

    def test_a_median_of_null_survives_serialisation(self, client):
        """Null is the answer for a topic nobody finished, not a missing field."""
        topic = client.get('/api/topics/T-115').get_json()['topic']
        assert topic['median_sessions_to_finish'] is None

    def test_unknown_topic_is_404(self, client):
        response = client.get('/api/topics/T-999')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Topic not found'}

    def test_a_partial_id_is_404_not_a_lucky_match(self, client):
        assert client.get('/api/topics/T-1').status_code == 404

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/topics/T-100').status_code == 401


def report_students(payload):
    """The student on each report, in the order served."""
    return [r['student_name'] for r in payload['reports']]


def report_dates(payload):
    return [r['date']['$date'][:10] for r in payload['reports']]


class TestListReports:
    """GET /api/reports -- the raw session records, not a rollup of them.

    The fixtures: Anthony 3/7 and 3/14 at Westside, Ava 3/10 at Westside, Chloe 2/1 at
    Eastside.
    """

    def test_lists_every_report(self, client):
        response = client.get('/api/reports')
        assert response.status_code == 200
        body = response.get_json()
        assert body['page']['total'] == 4
        assert len(body['reports']) == 4

    def test_newest_first(self, client):
        assert report_dates(client.get('/api/reports').get_json()) == [
            '2026-03-14', '2026-03-10', '2026-03-07', '2026-02-01'
        ]

    def test_paging_never_repeats_or_drops_a_row(self, client):
        """The property this route exists on. 29,382 real reports over 309 days is a
        median of 85 a day, so nearly every page boundary lands inside a date tie, and
        skip/limit over a partial order answers one row on two pages."""
        seen = []
        for offset in range(4):
            page = client.get(
                '/api/reports', query_string={'limit': 1, 'offset': offset}
            ).get_json()
            seen.extend(r['_id']['$oid'] for r in page['reports'])
        assert len(set(seen)) == 4

    def test_carries_the_student_key_the_row_links_to(self, client):
        """dwp_reports stores account_id and student_name and no key -- it is raw source
        data. An account_id alone is a household, so the key has to carry the name."""
        anthony = next(
            r for r in client.get('/api/reports').get_json()['reports']
            if r['student_name'] == 'Anthony Nguyen'
        )
        assert anthony['student_key'] == ANTHONY_KEY

    def test_bson_is_serialised(self, client):
        report = client.get('/api/reports').get_json()['reports'][0]
        assert '$oid' in report['_id']
        assert '$date' in report['date']

    def test_empty_result_is_an_empty_list(self, client):
        body = client.get('/api/reports', query_string={'query': 'nobody'}).get_json()
        assert body['reports'] == []
        assert body['page']['total'] == 0


class TestReportPrivacy:
    """What /api/reports must not send.

    The private fields are withheld everywhere. student_notes is the one that differs by
    route: a student's own profile serves it, and this list does not -- reading one
    child's notes and paging through 3,594 of them are different acts.
    """

    @pytest.mark.parametrize('field', [
        'row_hash',
        'lead_id',
        'internal_notes',
        'notes_from_center_director',
        'notes_for_center_director',
        'student_notes',
    ])
    def test_withheld_fields_are_not_served(self, client, field):
        reports = client.get('/api/reports').get_json()['reports']
        assert reports, 'no reports -- the assertion below is vacuous'
        assert all(field not in report for report in reports)

    def test_the_response_is_not_empty_of_everything(self, client):
        """Guards the guard: a projection that withheld the whole document would make
        every assertion above pass for the wrong reason."""
        chloe = next(
            r for r in client.get('/api/reports').get_json()['reports']
            if r['student_name'] == 'Chloe Tan'
        )
        assert chloe['session_summary_notes'] == 'worked through angle pairs'
        assert chloe['pages_completed'] == 7

    def test_the_profile_still_serves_the_student_notes(self, client):
        """The withholding is this route's, not a change to what the profile shows."""
        reports = client.get(f'/api/students/{CHLOE_KEY}').get_json()['dwp_reports']
        assert reports[0]['student_notes'] == 'gets discouraged when a page runs long'


class TestFilterReports:

    def test_query_matches_the_student(self, client):
        payload = client.get('/api/reports', query_string={'query': 'Chloe'}).get_json()
        assert report_students(payload) == ['Chloe Tan']

    def test_query_does_not_match_the_instructor(self, client):
        """The instructor is a column you read, not the thing you arrive looking for --
        and a search that quietly matched both would answer two questions at once."""
        payload = client.get('/api/reports', query_string={'query': 'Dana'}).get_json()
        assert payload['reports'] == []

    def test_filters_by_center(self, client):
        """The centers on a report are bare strings, not the {name, sessions} pairs
        students and instructors carry -- a criterion built for those matches nothing."""
        payload = client.get('/api/reports', query_string={'center': 'Eastside'}).get_json()
        assert report_students(payload) == ['Chloe Tan']

    def test_an_unknown_center_matches_nothing_rather_than_400ing(self, client):
        payload = client.get('/api/reports', query_string={'center': 'Xyz'}).get_json()
        assert payload['reports'] == []
        assert payload['page']['total'] == 0

    def test_filters_by_a_date_window_with_both_ends_inclusive(self, client):
        payload = client.get('/api/reports', query_string={
            'date_from': '2026-03-07', 'date_to': '2026-03-10'
        }).get_json()
        assert report_dates(payload) == ['2026-03-10', '2026-03-07']

    def test_the_filters_narrow_together(self, client):
        # Chloe is the only Eastside student and she is not a Nguyen.
        payload = client.get('/api/reports', query_string={
            'query': 'Nguyen', 'center': 'Eastside'
        }).get_json()
        assert payload['reports'] == []

    def test_refuses_a_backwards_window(self, client):
        response = client.get('/api/reports', query_string={
            'date_from': '2026-03-10', 'date_to': '2026-03-01'
        })
        assert response.status_code == 400

    def test_refuses_a_date_that_is_not_a_date(self, client):
        assert client.get('/api/reports?date_from=last-tuesday').status_code == 400


class TestSortReports:

    def test_sorts_by_student_and_breaks_the_tie_on_the_id(self, client):
        """Anthony has two sessions, so his name is not a total order on its own."""
        payload = client.get('/api/reports?sort=student').get_json()
        assert report_students(payload) == [
            'Anthony Nguyen', 'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan'
        ]

    def test_reverses_the_student_column_without_reversing_the_tie_break(self, client):
        """The tie-break is ascending whichever way the column runs -- models/sorting.py.
        Anthony's two rows hold the same order in both directions."""
        ascending = [r['_id']['$oid'] for r in
                     client.get('/api/reports?sort=student&direction=asc').get_json()['reports']]
        descending = [r['_id']['$oid'] for r in
                      client.get('/api/reports?sort=student&direction=desc').get_json()['reports']]
        assert ascending[:2] == descending[-2:]

    def test_sorts_by_date_oldest_first(self, client):
        payload = client.get('/api/reports?sort=date&direction=asc').get_json()
        assert report_dates(payload) == [
            '2026-02-01', '2026-03-07', '2026-03-10', '2026-03-14'
        ]

    def test_pages_a_sorted_list_without_repeating_a_row(self, client):
        seen = []
        for offset in range(4):
            seen += report_students(
                client.get(f'/api/reports?sort=student&limit=1&offset={offset}').get_json()
            )
        assert seen == ['Anthony Nguyen', 'Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan']

    def test_sorts_a_search_result(self, client):
        payload = client.get('/api/reports?query=Nguyen&sort=date&direction=asc').get_json()
        assert report_dates(payload) == ['2026-03-07', '2026-03-10', '2026-03-14']

    def test_refuses_a_column_that_does_not_exist(self, client):
        assert client.get('/api/reports?sort=bogus').status_code == 400

    def test_refuses_a_column_that_is_null_on_unfinalized_rows(self, client):
        """Pages and mathlete score are not sortable yet: both are null on the 1,068
        reports nobody finalized, and ordering them honestly needs the nulls-last
        treatment Topic._page carries. Refused rather than silently ignored."""
        assert client.get('/api/reports?sort=pages').status_code == 400

    def test_refuses_a_direction_that_is_not_one(self, client):
        assert client.get('/api/reports?sort=date&direction=sideways').status_code == 400


class TestGetReport:
    """GET /api/reports/<report_id> -- one session, whole."""

    def report_id(self, client):
        """Chloe's, which is the fixture carrying every private field and the notes."""
        return str(CHLOE_DWP_IDS[0])

    def test_returns_the_report(self, client):
        response = client.get(f'/api/reports/{self.report_id(client)}')
        assert response.status_code == 200

        report = response.get_json()['report']
        assert report['student_name'] == 'Chloe Tan'
        assert report['pages_completed'] == 7
        assert report['centers'] == ['Eastside']

    def test_carries_the_student_key(self, client):
        """The header links back to the student, and dwp_reports stores no key."""
        report = client.get(f'/api/reports/{self.report_id(client)}').get_json()['report']
        assert report['student_key'] == CHLOE_KEY

    def test_serves_the_student_notes_the_list_withholds(self, client):
        """⚠️ The one deliberate difference between DETAIL_PROJECTION and LIST_PROJECTION.

        Asserted as one test rather than two so the difference reads as a decision. One
        report opened on purpose is the act the student's own profile already allows;
        paging through 3,594 of them behind a date filter is not.
        """
        detail = client.get(f'/api/reports/{self.report_id(client)}').get_json()['report']
        assert detail['student_notes'] == 'gets discouraged when a page runs long'

        listed = client.get('/api/reports').get_json()['reports']
        assert listed, 'no reports -- the assertion below is vacuous'
        assert all('student_notes' not in report for report in listed)

    @pytest.mark.parametrize('field', [
        'row_hash',
        'lead_id',
        'internal_notes',
        'notes_from_center_director',
        'notes_for_center_director',
    ])
    def test_private_fields_are_still_withheld(self, client, field):
        """Everything PRIVATE_FIELDS covers stays server-side on this route too."""
        report = client.get(f'/api/reports/{self.report_id(client)}').get_json()['report']
        assert field not in report

    def test_bson_is_serialised(self, client):
        report = client.get(f'/api/reports/{self.report_id(client)}').get_json()['report']
        assert '$oid' in report['_id']
        assert '$date' in report['date']

    def test_unknown_id_is_404(self, client):
        response = client.get('/api/reports/64b0000000000000000000ff')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Report not found'}

    def test_a_malformed_id_is_404_rather_than_500(self, client):
        """A mistyped URL reaches ObjectId() as arbitrary text. Without find_by_id
        absorbing InvalidId this is a stack trace, and the honest answer is the same
        either way: there is no such report."""
        response = client.get('/api/reports/not-an-oid')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Report not found'}


class TestReportPagination:

    def test_defaults_to_one_page(self, client):
        page = client.get('/api/reports').get_json()['page']
        assert page['limit'] == 50
        assert page['offset'] == 0
        assert page['returned'] == 4

    def test_total_counts_every_match_not_the_page(self, client):
        body = client.get('/api/reports', query_string={'limit': 1}).get_json()
        assert body['page']['returned'] == 1
        assert body['page']['total'] == 4

    def test_the_total_follows_the_filter(self, client):
        body = client.get('/api/reports', query_string={'center': 'Eastside'}).get_json()
        assert body['page']['total'] == 1

    def test_refuses_a_limit_of_zero(self, client):
        # pymongo reads .limit(0) as "no limit", which would serve the collection.
        assert client.get('/api/reports?limit=0').status_code == 400


class TestMetrics:

    def test_totals(self, client):
        body = client.get('/api/metrics').get_json()
        assert body['total_students'] == 3
        assert body['total_instructors'] == 3
        assert body['total_dwp_reports'] == 4
        assert body['total_attendance_records'] == 4

    def test_instructor_count_is_independent_of_the_student_count(self, mongo):
        """Equal in the fixtures by coincidence -- so prove the number is its own."""
        from app import create_app
        from tests.sample_data import INSTRUCTORS, STUDENTS

        mongo['students'].insert_many(STUDENTS)
        mongo['instructors'].insert_many(INSTRUCTORS[:2])

        app = create_app()
        app.config['TESTING'] = True
        body = app.test_client().get(
            '/api/metrics', headers={'X-API-Key': TEST_API_KEY}
        ).get_json()

        assert body['total_students'] == 3
        assert body['total_instructors'] == 2

    def test_averages(self, client):
        body = client.get('/api/metrics').get_json()
        assert body['avg_dwp_per_student'] == 1.33
        assert body['avg_attendance_per_student'] == 1.33

    def test_averages_are_zero_when_there_are_no_students(self, mongo):
        """Guards the division; an empty directory must not 500."""
        from app import create_app

        app = create_app()
        app.config['TESTING'] = True
        # Own client, so it needs the credential the shared fixture would have supplied.
        body = app.test_client().get(
            '/api/metrics', headers={'X-API-Key': TEST_API_KEY}
        ).get_json()

        assert body['total_students'] == 0
        assert body['total_instructors'] == 0
        assert body['avg_dwp_per_student'] == 0
        assert body['avg_attendance_per_student'] == 0

    def test_database_failure_returns_500(self, client, monkeypatch):
        from models import Student

        monkeypatch.setattr(
            Student, 'count_all',
            staticmethod(lambda: (_ for _ in ()).throw(RuntimeError('cluster down')))
        )
        response = client.get('/api/metrics')
        assert response.status_code == 500
        assert 'cluster down' in response.get_json()['error']


class TestCors:
    """The API is unauthenticated to a browser only in the sense that a page cannot
    supply X-API-Key -- but a permissive origin list is still what decides whether a
    drive-by page may READ a response. These assert the closed default."""

    @pytest.mark.parametrize('origin', [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
    ])
    def test_the_dev_origins_are_allowed(self, client, origin):
        response = client.get('/api/health', headers={'Origin': origin})
        assert response.headers.get('Access-Control-Allow-Origin') == origin

    @pytest.mark.parametrize('origin', [
        'https://evil.test',
        'http://localhost:5174',            # neighbouring port is a different origin
        'https://localhost:5173',           # scheme is part of the origin
        'http://sub.localhost:5173',
    ])
    def test_an_unlisted_origin_gets_no_allow_header(self, client, origin):
        """No header means the browser refuses to hand the body to the page. The
        response still has a body -- CORS is enforced by the browser, not the server."""
        response = client.get('/api/health', headers={'Origin': origin})
        assert 'Access-Control-Allow-Origin' not in response.headers

    def test_no_origin_header_is_unaffected(self, client):
        """curl and server-to-server callers send no Origin and are not CORS-governed."""
        assert client.get('/api/health').status_code == 200

    def test_cors_is_scoped_to_the_api_prefix(self, client):
        """The rule is r'/api/*'; a non-API path must not pick up the header."""
        response = client.get('/', headers={'Origin': 'http://localhost:5173'})
        assert 'Access-Control-Allow-Origin' not in response.headers

    def test_preflight_permits_the_api_key_header(self, anonymous_client):
        """X-API-Key is not a CORS-simple header, so every browser call preflights. If
        the header is not allowed by name, the real request is never sent."""
        response = anonymous_client.options(
            '/api/students',
            headers={
                'Origin': 'http://localhost:5173',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'X-API-Key',
            },
        )
        assert response.status_code < 400
        allowed = response.headers.get('Access-Control-Allow-Headers', '')
        assert 'X-API-Key'.lower() in allowed.lower()

    def test_preflight_from_an_unlisted_origin_is_not_approved(self, anonymous_client):
        response = anonymous_client.options(
            '/api/students',
            headers={
                'Origin': 'https://evil.test',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'X-API-Key',
            },
        )
        assert 'Access-Control-Allow-Origin' not in response.headers


class TestParseBool:
    """FLASK_DEBUG decides whether the Werkzeug debugger runs, and its console executes
    arbitrary Python with MONGODB_URI and API_KEY in reach. Anything unrecognised has to
    resolve to False -- a typo must fail towards off."""

    @pytest.mark.parametrize('value', ['1', 'true', 'TRUE', 'True', 'yes', 'on', ' on '])
    def test_recognised_truthy_values(self, value):
        assert parse_bool(value) is True

    @pytest.mark.parametrize('value', ['0', 'false', 'no', 'off'])
    def test_recognised_falsey_values(self, value):
        assert parse_bool(value) is False

    @pytest.mark.parametrize('value', ['ture', 'y', 'enabled', 'sure', '2', 'debug'])
    def test_an_unrecognised_value_is_false(self, value):
        """'ture' is the typo that matters: it must not enable the debugger."""
        assert parse_bool(value) is False

    @pytest.mark.parametrize('value', [None, '', '   '])
    def test_unset_takes_the_default(self, value):
        assert parse_bool(value) is False
        assert parse_bool(value, default=True) is True


class TestParsePort:

    def test_reads_a_number(self):
        assert parse_port('8080') == 8080

    @pytest.mark.parametrize('value', ['abc', '', None, '80.5'])
    def test_a_non_number_is_rejected_loudly(self, value):
        """Silently defaulting would bind a port the operator did not ask for."""
        with pytest.raises(ValueError, match='must be a number'):
            parse_port(value)

    @pytest.mark.parametrize('value', ['0', '65536', '-1'])
    def test_an_out_of_range_port_is_rejected(self, value):
        with pytest.raises(ValueError, match='between 1 and 65535'):
            parse_port(value)


class TestServerDefaults:

    def test_the_default_host_is_loopback(self, monkeypatch):
        """0.0.0.0 binds every interface, putting the dev server on the local network."""
        monkeypatch.delenv('HOST', raising=False)
        assert os.getenv('HOST', '127.0.0.1') == '127.0.0.1'

    def test_debug_is_off_unless_asked_for(self):
        """The shipped default must not be the debugger."""
        assert parse_bool(os.getenv('FLASK_DEBUG')) is False


class TestParseOrigins:

    def test_a_comma_separated_list(self):
        assert parse_origins('http://a, http://b') == ['http://a', 'http://b']

    def test_trailing_slashes_are_stripped(self):
        """A browser's Origin header never has one, so a configured slash would mean
        the entry silently never matches."""
        assert parse_origins('http://a/') == ['http://a']

    @pytest.mark.parametrize('value', [None, '', '   ', ','])
    def test_unset_falls_back_to_the_dev_origins(self, value):
        assert parse_origins(value) == DEFAULT_ORIGINS

    def test_wildcard_is_available_but_must_be_explicit(self):
        assert parse_origins('*') == '*'


def bars(payload):
    """The distribution as {center: count} -- the shape the assertions below read."""
    return {row['center']: row['count'] for row in payload['distribution']}


def keyed(payload):
    """Buckets as {key: bucket}, for asserting on one without indexing by position."""
    return {bucket['key']: bucket for bucket in payload['buckets']}


class TestStudentDistribution:
    """GET /api/students/distribution -- the center bar chart above the students list."""

    def get(self, client, **params):
        response = client.get('/api/students/distribution', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def test_counts_the_students_at_each_center(self, client):
        assert bars(self.get(client)) == {'Eastside': 1, 'Westside': 2}

    def test_the_bars_account_for_every_row_the_list_would_show(self, client):
        """⚠️ The invariant the whole design rests on.

        This chart reads the `students` collection through the list's own criteria rather
        than taking a slice of /api/centers/metrics, so that the bars and the table
        underneath are one population counted once. If this ever fails, the page is showing
        two different answers to the same question.
        """
        payload = self.get(client)
        assert payload['counted'] + payload['no_center'] == payload['total'] == 3

    def test_the_bars_are_ordered_by_name_not_by_count(self, client):
        """So they hold position as filters are ticked -- /api/centers sorts for the same
        reason. Westside is the taller bar, and still comes second."""
        assert [row['center'] for row in self.get(client)['distribution']] == [
            'Eastside', 'Westside'
        ]

    def test_a_center_filter_narrows_it(self, client):
        payload = self.get(client, center='Westside')
        assert bars(payload) == {'Westside': 2}
        assert payload['total'] == 2

    def test_a_search_narrows_it(self, client):
        """?query= is the list's search, spelled the same way, so the chart follows it."""
        assert bars(self.get(client, query='Nguyen')) == {'Westside': 2}

    def test_a_range_filter_narrows_it(self, client):
        """The FILTERABLE columns too -- only Anthony has two sessions."""
        assert bars(self.get(client, sessions_min=2)) == {'Westside': 1}

    def test_an_unknown_center_is_an_empty_chart_not_an_error(self, client):
        """"Nothing at Xyz" is a correct answer to a filter -- see models/filters.py."""
        payload = self.get(client, center='Xyz')
        assert payload['distribution'] == [] and payload['total'] == 0

    def test_a_student_with_no_center_is_counted_apart_rather_than_dropped(self, client,
                                                                          seeded_db):
        """$unwind would discard the row silently; preserveNullAndEmptyArrays keeps it."""
        seeded_db['students'].insert_one({
            'student_key': f'{ACCOUNT_TAN}_nikhil-rao',
            'account_id': ACCOUNT_TAN,
            'student_name': 'Nikhil Rao',
            'total_sessions': 1,
            'centers': [],
        })

        payload = self.get(client)
        assert payload['total'] == 4
        assert payload['no_center'] == 1
        assert bars(payload) == {'Eastside': 1, 'Westside': 2}
        assert payload['counted'] + payload['no_center'] == payload['total']

    def test_a_malformed_bound_is_refused(self, client):
        assert client.get('/api/students/distribution?sessions_min=abc').status_code == 400

    def test_a_backwards_range_is_refused(self, client):
        assert client.get(
            '/api/students/distribution?sessions_min=9&sessions_max=1'
        ).status_code == 400

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/students/distribution').status_code == 401


class TestInstructorDistribution:
    """GET /api/instructors/distribution -- the same chart above the instructors list."""

    def get(self, client, **params):
        response = client.get('/api/instructors/distribution', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def test_an_instructor_at_two_centers_is_one_person_and_two_bars(self, client):
        """⚠️ Where this route differs from the students one, and the page must say so.

        Dana works at both. The bars come to 4 across a roster of 3, and that overshoot is
        the answer rather than an error -- 11 of 103 do this in the live data.
        """
        payload = self.get(client)
        assert bars(payload) == {'Eastside': 2, 'Westside': 2}
        assert payload['total'] == 3
        assert payload['counted'] == 4

    def test_a_center_filter_does_not_leak_the_other_centers_of_who_it_matched(self, client):
        """⚠️ The regression test for the $match/$unwind trap.

        `center_criteria` selects a *document* if any of its centers matches; $unwind then
        emits every center on it. Without the second $match in models/distribution.py, Dana
        matching Westside also draws an Eastside bar -- a center the caller filtered out.
        """
        payload = self.get(client, center='Westside')
        assert bars(payload) == {'Westside': 2}
        assert 'Eastside' not in bars(payload)
        assert payload['total'] == 2

    def test_the_bars_never_come_to_less_than_the_roster(self, client):
        payload = self.get(client)
        assert payload['counted'] >= payload['total']

    def test_a_search_narrows_it(self, client):
        """Dana and Marcus share a surname; Sam does not."""
        payload = self.get(client, query='Reyes')
        assert bars(payload) == {'Eastside': 1, 'Westside': 2}
        assert payload['total'] == 2

    def test_a_range_filter_narrows_it(self, client):
        assert self.get(client, sessions_min=2)['total'] < 3

    def test_an_unknown_center_is_an_empty_chart_not_an_error(self, client):
        assert self.get(client, center='Xyz')['distribution'] == []

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/instructors/distribution').status_code == 401


class TestReportTrends:
    """GET /api/reports/trends -- the report-volume chart above the reports list."""

    def get(self, client, **params):
        response = client.get('/api/reports/trends', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def test_counts_the_sessions_in_each_bucket(self, client):
        buckets = keyed(self.get(client, interval='month',
                                 date_from='2026-02-01', date_to='2026-03-31'))
        assert buckets['2026-02']['sessions'] == 1
        assert buckets['2026-03']['sessions'] == 3

    def test_a_co_taught_session_is_one_session(self, client):
        """Anthony's 3/14 session has two instructors and is still one row of the table."""
        buckets = keyed(self.get(client, interval='day',
                                 date_from='2026-03-14', date_to='2026-03-14'))
        assert buckets['2026-03-14']['sessions'] == 1

    def test_the_axis_has_no_holes(self, client):
        """A day nobody attended is a zero. Five of these eight are empty."""
        payload = self.get(client, interval='day',
                           date_from='2026-03-07', date_to='2026-03-14')
        assert len(payload['buckets']) == 8
        assert sum(bucket['sessions'] for bucket in payload['buckets']) == 3
        assert sum(1 for bucket in payload['buckets'] if bucket['sessions'] == 0) == 5

    def test_the_week_buckets_are_iso_weeks(self, client):
        """2026-02-01 is a Sunday, so it lands in the week that began 2026-01-26."""
        payload = self.get(client, interval='week',
                           date_from='2026-02-01', date_to='2026-03-14')
        first = payload['buckets'][0]
        assert first['key'] == '2026-W05'
        assert first['start']['$date'].startswith('2026-01-26')
        assert first['sessions'] == 1

    def test_an_edge_bucket_the_window_only_part_covers_is_marked(self, client):
        """So the chart can say the bar is short because the window is."""
        payload = self.get(client, interval='week',
                           date_from='2026-02-01', date_to='2026-03-14')
        assert payload['buckets'][0]['partial'] is True
        assert payload['buckets'][-1]['partial'] is True

    def test_it_draws_volume_and_not_the_rest_of_what_it_computed(self, client):
        """Pages and distinct students come off the same pass and have readers elsewhere."""
        bucket = self.get(client, interval='month',
                          date_from='2026-03-01', date_to='2026-03-31')['buckets'][0]
        assert 'sessions' in bucket
        assert 'pages_completed' not in bucket and 'students' not in bucket

    def test_the_window_is_anchored_on_the_reports_not_the_built_aggregate(
        self, client, seeded_db
    ):
        """⚠️ The one test that can tell the two latest_session_date methods apart.

        `students.last_session_date` and `max(dwp_reports.date)` are both 2026-03-14 in the
        fixtures, so only a report newer than any student's rollup shows which one the
        window follows. A chart anchored on the built collection would lose these days
        whenever an import has run and a rebuild has not.
        """
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_NGUYEN,
            'student_name': 'Anthony Nguyen',
            'date': datetime(2026, 4, 1),
            'centers': ['Westside'],
            'instructors': ['Marcus Reyes'],
            'pages_completed': 2,
        })

        payload = self.get(client, interval='day')
        assert payload['buckets'][-1]['key'] == '2026-04-01'
        assert payload['buckets'][-1]['sessions'] == 1

    def test_the_default_window_is_as_wide_as_the_interval_needs(self, client):
        assert len(self.get(client, interval='day')['buckets']) == 30
        assert len(self.get(client, interval='month')['buckets']) == 12

    def test_a_center_filter_narrows_it(self, client):
        payload = keyed(self.get(client, interval='month', center='Eastside',
                                 date_from='2026-02-01', date_to='2026-03-31'))
        assert payload['2026-02']['sessions'] == 1
        assert payload['2026-03']['sessions'] == 0

    def test_an_instructor_filter_narrows_it(self, client):
        """The filter the reports list grew at the same time, so the table can follow."""
        payload = keyed(self.get(client, interval='month', instructor='Sam Ortiz',
                                 date_from='2026-02-01', date_to='2026-03-31'))
        assert payload['2026-02']['sessions'] == 1
        assert payload['2026-03']['sessions'] == 0

    def test_a_search_narrows_it(self, client):
        payload = self.get(client, interval='month', query='Ava',
                           date_from='2026-03-01', date_to='2026-03-31')
        assert payload['buckets'][0]['sessions'] == 1

    def test_an_unknown_instructor_is_an_empty_chart_not_an_error(self, client):
        payload = self.get(client, interval='month', instructor='Nobody At All',
                           date_from='2026-02-01', date_to='2026-03-31')
        assert [bucket['sessions'] for bucket in payload['buckets']] == [0, 0]

    def test_it_echoes_the_window_it_answered_for(self, client):
        """The response outlives the request, and "12 buckets" means nothing alone."""
        payload = self.get(client, interval='month', center='Westside',
                           date_from='2026-02-01', date_to='2026-03-31')
        assert payload['interval'] == 'month'
        assert payload['range']['start']['$date'].startswith('2026-02-01')
        assert payload['range']['end']['$date'].startswith('2026-03-31')
        assert payload['centers'] == ['Westside']

    def test_an_unknown_interval_is_refused(self, client):
        """An allowlist, as ?sort= is: there is no correct answer to a fortnight."""
        response = client.get('/api/reports/trends?interval=fortnight')
        assert response.status_code == 400
        assert 'day, week, month' in response.get_json()['error']

    def test_a_range_too_wide_to_chart_is_refused_rather_than_truncated(self, client):
        """A truncated time series reads as a real decline; a truncated page does not."""
        response = client.get(
            '/api/reports/trends?interval=day&date_from=2000-01-01&date_to=2026-03-14'
        )
        assert response.status_code == 400
        assert str(trends.MAX_BUCKETS) in response.get_json()['error']

    def test_a_malformed_date_is_refused(self, client):
        assert client.get('/api/reports/trends?date_from=not-a-date').status_code == 400

    def test_a_backwards_range_is_refused(self, client):
        assert client.get(
            '/api/reports/trends?date_from=2026-03-31&date_to=2026-02-01'
        ).status_code == 400

    def test_an_empty_collection_is_an_empty_chart_and_not_todays_date(self, client,
                                                                      seeded_db):
        seeded_db['dwp_reports'].delete_many({})
        payload = self.get(client, interval='day')
        assert payload['buckets'] == []
        assert payload['range'] is None

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/reports/trends').status_code == 401


class TestHomeTrends:
    """GET /api/home/trends -- the Home page's monthly activity charts."""

    def get(self, client, **params):
        response = client.get('/api/home/trends', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def test_it_is_monthly_without_being_asked(self, client):
        assert self.get(client)['interval'] == 'month'
        assert len(self.get(client)['buckets']) == 12

    def test_it_reports_sessions_students_pages_and_the_outstanding_count(self, client):
        bucket = keyed(self.get(client, date_from='2026-03-01',
                                date_to='2026-03-31'))['2026-03']
        assert bucket['sessions'] == 3
        assert bucket['pages_completed'] == 16
        assert bucket['unfinalized'] == 3

    def test_pages_are_the_pages_recorded_not_the_pages_credited(self, client):
        """⚠️ March's co-taught session turned 7 pages, not 14.

        Summing the instructors collection over the same month gives 23 against the 16
        actually recorded. This counts sessions, where each is one row.
        """
        assert keyed(self.get(client, date_from='2026-03-01',
                              date_to='2026-03-31'))['2026-03']['pages_completed'] == 16

    def test_siblings_count_as_two_students(self, client):
        """Anthony and Ava share an account. Grouping by the account would say one."""
        assert keyed(self.get(client, date_from='2026-03-01',
                              date_to='2026-03-31'))['2026-03']['students'] == 2

    def test_distinct_students_do_not_sum_across_buckets(self, client, seeded_db):
        """⚠️ Someone active in two months is counted in both, which a trend line means.

        Three students exist; these two months report two each. A reader totalling the
        column gets four, which is a property of the question rather than a bug -- but it
        is also what an "optimisation" flattening the nested $group would quietly break.
        """
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_NGUYEN,
            'student_name': 'Anthony Nguyen',
            'date': datetime(2026, 2, 10),
            'centers': ['Westside'],
            'instructors': ['Marcus Reyes'],
            'pages_completed': 1,
        })

        buckets = keyed(self.get(client, date_from='2026-02-01', date_to='2026-03-31'))
        assert buckets['2026-02']['students'] == 2
        assert buckets['2026-03']['students'] == 2

    def test_it_reports_no_finalized_count(self, client):
        """It is sessions minus unfinalized; two figures that must agree can disagree."""
        bucket = self.get(client, date_from='2026-03-01',
                          date_to='2026-03-31')['buckets'][0]
        assert 'finalized' not in bucket

    def test_a_center_filter_narrows_it(self, client):
        payload = self.get(client, center='Eastside',
                           date_from='2026-02-01', date_to='2026-03-31')
        assert keyed(payload)['2026-02']['sessions'] == 1
        assert payload['centers'] == ['Eastside']

    def test_widening_to_three_months_does_not_change_the_response(self, client):
        """The README's "extend one month to three" is a date bound, not a new contract."""
        one = self.get(client, date_from='2026-03-01', date_to='2026-03-31')
        three = self.get(client, date_from='2026-01-01', date_to='2026-03-31')
        assert len(one['buckets']) == 1 and len(three['buckets']) == 3
        assert set(one['buckets'][0]) == set(three['buckets'][0])

    def test_an_unknown_interval_is_refused(self, client):
        assert client.get('/api/home/trends?interval=fortnight').status_code == 400

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/home/trends').status_code == 401


class TestInstructorTrends:
    """GET /api/instructors/trends -- the workload chart."""

    def get(self, client, **params):
        response = client.get('/api/instructors/trends', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def test_it_narrows_to_one_instructors_sessions(self, client):
        payload = keyed(self.get(client, instructor='Sam Ortiz', interval='month',
                                 date_from='2026-02-01', date_to='2026-03-31'))
        assert payload['2026-02']['sessions'] == 1
        assert payload['2026-03']['sessions'] == 0

    def test_co_taught_pages_are_credited_in_full_to_each_instructor(self, client):
        """⚠️ Right for "work in sessions I ran", and not summable across instructors.

        Dana taught all three March sessions (16 pages); Marcus only the co-taught 3/14,
        whose 7 pages are credited to him in full as well. Adding the two answers gives 23
        against the 16 actually recorded -- the 168,623-against-153,360 trap, now reachable
        through a query parameter. Label the column; do not total it.
        """
        window = dict(interval='month', date_from='2026-03-01', date_to='2026-03-31')
        dana = keyed(self.get(client, instructor='Dana Reyes', **window))['2026-03']
        marcus = keyed(self.get(client, instructor='Marcus Reyes', **window))['2026-03']

        assert (dana['sessions'], dana['pages_completed']) == (3, 16)
        assert (marcus['sessions'], marcus['pages_completed']) == (1, 7)
        assert dana['pages_completed'] + marcus['pages_completed'] == 23

    def test_several_instructors_are_a_union_and_a_shared_session_counts_once(self, client):
        """Asking for both is not the same as adding them up.

        Dana's 3 sessions and Marcus's 1 overlap on 3/14, so the union is 3 sessions and
        the 16 pages actually recorded -- not the 4 and 23 that summing the two separate
        answers gives. The filter widens the match; it does not count anything twice.
        """
        payload = self.get(client, instructor=['Dana Reyes', 'Marcus Reyes'],
                           interval='month', date_from='2026-03-01', date_to='2026-03-31')
        assert payload['buckets'][0]['sessions'] == 3
        assert payload['buckets'][0]['pages_completed'] == 16

    def test_a_center_filter_narrows_it(self, client):
        payload = keyed(self.get(client, center='Westside', interval='month',
                                 date_from='2026-02-01', date_to='2026-03-31'))
        assert payload['2026-02']['sessions'] == 0
        assert payload['2026-03']['sessions'] == 3

    def test_no_instructor_given_is_the_whole_program(self, client):
        payload = self.get(client, interval='month',
                           date_from='2026-02-01', date_to='2026-03-31')
        assert sum(bucket['sessions'] for bucket in payload['buckets']) == 4

    def test_an_unknown_instructor_is_an_empty_chart_not_an_error(self, client):
        payload = self.get(client, instructor='Nobody At All', interval='month',
                           date_from='2026-02-01', date_to='2026-03-31')
        assert [bucket['sessions'] for bucket in payload['buckets']] == [0, 0]

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/instructors/trends').status_code == 401


class TestReportQuality:
    """GET /api/reports/quality -- the data-quality monitoring cards."""

    def get(self, client, **params):
        response = client.get('/api/reports/quality', query_string=params)
        assert response.status_code == 200
        return response.get_json()

    def counts(self, client, **params):
        return {row['key']: row['count'] for row in self.get(client, **params)['checks']}

    def test_it_counts_the_reports_nobody_finalized(self, client):
        """The actionable one: the reports a manager can still chase."""
        assert self.counts(client)['unfinalized'] == 4
        assert self.get(client)['total'] == 4

    def test_a_finalized_report_leaves_the_outstanding_count(self, client, seeded_db):
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_NGUYEN,
            'student_name': 'Anthony Nguyen',
            'date': datetime(2026, 3, 21),
            'centers': ['Westside'],
            'instructors': ['Dana Reyes'],
            'pages_completed': 3,
            'finalized': True,
            'session_start': datetime(2026, 3, 21, 15, 0),
            'session_end': datetime(2026, 3, 21, 16, 0),
            'topics': [{'id': 'PK-1', 'name': 'Fractions', 'status': 'Worked On'}],
        })

        counts = self.counts(client)
        assert counts['unfinalized'] == 4        # the new one is not outstanding
        assert self.get(client)['total'] == 5

    def test_it_counts_sessions_with_no_topics_recorded(self, client, seeded_db):
        """An empty list and an absent field are the same finding to a reader."""
        for topics in ([], None):
            seeded_db['dwp_reports'].insert_one({
                '_id': ObjectId(),
                'account_id': ACCOUNT_TAN,
                'student_name': 'Chloe Tan',
                'date': datetime(2026, 2, 15),
                'centers': ['Eastside'],
                'instructors': ['Sam Ortiz'],
                'topics': topics,
            })

        assert self.counts(client)['no_topics'] == 2

    def test_it_counts_unstaffed_sessions(self, client, seeded_db):
        """73 of these in the live data, and they still count as sessions."""
        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_TAN,
            'student_name': 'Chloe Tan',
            'date': datetime(2026, 2, 15),
            'centers': ['Eastside'],
            'instructors': [],
        })

        assert self.counts(client)['no_instructor'] == 1

    def test_it_counts_sessions_that_never_recorded_an_end_time(self, client):
        """217 in the live data -- sessions that cannot be given a duration."""
        assert self.counts(client)['missing_session_end'] == 4

    def test_the_tripwire_checks_are_present_even_at_zero(self, client, seeded_db):
        """A check reading zero is the answer, not a reason to omit the card.

        A null `date` matters more than its current count: every trend chart buckets on it,
        so one would drop out of every chart silently rather than show up as a gap.
        """
        counts = self.counts(client)
        assert counts['missing_date'] == 0

        seeded_db['dwp_reports'].insert_one({
            '_id': ObjectId(),
            'account_id': ACCOUNT_TAN,
            'student_name': 'Chloe Tan',
            'date': None,
            'centers': ['Eastside'],
        })
        assert self.counts(client)['missing_date'] == 1

    def test_it_finds_the_natural_keys_two_documents_share(self, client, seeded_db):
        """⚠️ The condition outlives the import that created it.

        `import_reports.py` reports an ambiguous key to the console and skips the row, so
        the event is gone -- but both colliding documents are still stored, which is what
        makes this a current-state check rather than something waiting on import history.
        These are the rows an import can no longer update.
        """
        collision = {
            'account_id': ACCOUNT_TAN,
            'student_name': 'Chloe Tan',
            'date': datetime(2026, 2, 1),
            'session_start': datetime(2026, 2, 1, 15, 30),
        }
        seeded_db['dwp_reports'].insert_many([
            {'_id': ObjectId(), **collision, 'centers': ['Eastside'], 'pages_completed': 2},
            {'_id': ObjectId(), **collision, 'centers': ['Eastside'], 'pages_completed': 5},
        ])

        found = self.get(client)['ambiguous_keys']
        assert len(found) == 1
        assert found[0]['student_name'] == 'Chloe Tan'
        assert found[0]['documents'] == 2

    def test_a_key_only_one_document_holds_is_not_ambiguous(self, client):
        assert self.get(client)['ambiguous_keys'] == []

    def test_a_center_filter_scopes_it(self, client):
        """So a manager sees their own centers rather than the whole program."""
        payload = self.get(client, center='Westside')
        assert payload['total'] == 3
        assert payload['centers'] == ['Westside']

    def test_a_date_filter_scopes_it(self, client):
        assert self.get(client, date_from='2026-03-01')['total'] == 3

    def test_an_unknown_center_is_zeroes_rather_than_an_error(self, client):
        payload = self.get(client, center='Xyz')
        assert payload['total'] == 0
        assert all(row['count'] == 0 for row in payload['checks'])

    def test_a_malformed_date_is_refused(self, client):
        assert client.get('/api/reports/quality?date_from=nope').status_code == 400

    def test_it_returns_counts_and_not_the_reports_behind_them(self, client):
        """Every row counted here is about a named child. Drill-down is the list's job."""
        payload = self.get(client)
        assert set(payload) == {'centers', 'total', 'checks', 'ambiguous_keys'}
        assert all(set(row) == {'key', 'count'} for row in payload['checks'])

    def test_the_route_requires_a_credential(self, anonymous_client):
        assert anonymous_client.get('/api/reports/quality').status_code == 401


class TestChartRoutesWithholdPrivateFields:
    """None of the six chart routes goes through LIST_PROJECTION, so none may leak.

    Cheap, and the one class of mistake that would not show up as a wrong number. The
    ambiguous-key rows are the closest thing any of them ships to a document, and they
    carry the four key fields and nothing else.
    """

    CHART_ROUTES = (
        '/api/students/distribution',
        '/api/instructors/distribution',
        '/api/reports/trends',
        '/api/home/trends',
        '/api/instructors/trends',
        '/api/reports/quality',
    )

    @pytest.mark.parametrize('route', CHART_ROUTES)
    def test_no_private_field_reaches_the_response(self, client, route):
        body = client.get(route).get_data(as_text=True)
        for field in ('row_hash', 'lead_id', 'student_notes', 'internal_notes',
                      'notes_from_center_director'):
            assert field not in body
