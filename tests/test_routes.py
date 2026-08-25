"""HTTP surface, end to end over the in-memory database."""

import pytest

from tests.sample_data import ACCOUNT_NGUYEN, ACCOUNT_TAN, ANTHONY_KEY, CHLOE_KEY


def names(payload):
    return sorted(s['student_name'] for s in payload)


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
            s for s in client.get('/api/students').get_json()
            if s['student_key'] == ANTHONY_KEY
        )
        assert '$oid' in student['_id']
        assert '$date' in student['last_session_date']

    def test_empty_result_is_an_empty_list(self, client):
        response = client.get('/api/students', query_string={'account_id': 'nope'})
        assert response.status_code == 200
        assert response.get_json() == []


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
        assert response.get_json() == []


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

    def test_unknown_student_is_404(self, client):
        response = client.get('/api/students/no-such-account_nobody')
        assert response.status_code == 404
        assert response.get_json() == {'error': 'Student not found'}


class TestMetrics:

    def test_totals(self, client):
        body = client.get('/api/metrics').get_json()
        assert body['total_students'] == 3
        assert body['total_dwp_reports'] == 4
        assert body['total_attendance_records'] == 4

    def test_averages(self, client):
        body = client.get('/api/metrics').get_json()
        assert body['avg_dwp_per_student'] == 1.33
        assert body['avg_attendance_per_student'] == 1.33

    def test_averages_are_zero_when_there_are_no_students(self, mongo):
        """Guards the division; an empty directory must not 500."""
        from app import create_app

        app = create_app()
        app.config['TESTING'] = True
        body = app.test_client().get('/api/metrics').get_json()

        assert body['total_students'] == 0
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


@pytest.mark.parametrize('origin', ['http://localhost:3000', 'https://example.test'])
def test_cors_allows_any_frontend_origin(client, origin):
    """origins='*' -- Flask-CORS echoes the caller's Origin rather than a literal '*',
    so any origin must come back allowed."""
    response = client.get('/api/health', headers={'Origin': origin})
    assert response.headers.get('Access-Control-Allow-Origin') in (origin, '*')


def test_cors_is_scoped_to_the_api_prefix(client):
    """The rule is r'/api/*'; a non-API path must not pick up the header."""
    response = client.get('/', headers={'Origin': 'http://localhost:3000'})
    assert 'Access-Control-Allow-Origin' not in response.headers
