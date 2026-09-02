"""HTTP surface, end to end over the in-memory database."""

import os

import pytest

from config import DEFAULT_ORIGINS, parse_bool, parse_origins, parse_port
from tests.conftest import TEST_API_KEY
from tests.sample_data import ACCOUNT_NGUYEN, ACCOUNT_TAN, ANTHONY_KEY, CHLOE_KEY


def names(payload):
    return sorted(s['student_name'] for s in payload['students'])


def instructor_names(payload):
    return sorted(i['instructor_name'] for i in payload['instructors'])


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
        """82 instructors on the widest topic -- the array that balloons a list page."""
        listed = client.get('/api/topics').get_json()['topics']
        assert all('instructors' not in t for t in listed)
        assert all('unique_instructors' in t for t in listed)

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
        assert topic['unique_instructors'] == 0

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
