"""HTTP surface, end to end over the in-memory database."""

import os

import pytest

from config import DEFAULT_ORIGINS, parse_bool, parse_origins, parse_port
from tests.conftest import TEST_API_KEY
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
        # Own client, so it needs the credential the shared fixture would have supplied.
        body = app.test_client().get(
            '/api/metrics', headers={'X-API-Key': TEST_API_KEY}
        ).get_json()

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
