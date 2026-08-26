"""Request authentication.

The point of these is that the API is closed by default. A test that only checked "a
valid key works" would pass just as happily against an API that let everyone in, so most
of what follows is about what happens WITHOUT a credential.
"""

import pytest

import auth
from tests.conftest import TEST_API_KEY

PROTECTED_PATHS = [
    '/api/students',
    '/api/students/search?q=nguyen',
    '/api/metrics',
]


class TestClosedByDefault:

    @pytest.mark.parametrize('path', PROTECTED_PATHS)
    def test_no_credential_is_rejected(self, anonymous_client, path):
        response = anonymous_client.get(path)
        assert response.status_code == 401
        assert response.get_json() == {'error': 'Unauthorized'}

    @pytest.mark.parametrize('path', PROTECTED_PATHS)
    def test_a_valid_key_is_accepted(self, client, path):
        assert client.get(path).status_code == 200

    def test_the_student_detail_route_is_protected_too(self, anonymous_client, seeded_db):
        """Parameterised routes are easy to forget when exemptions are listed by path."""
        from tests.sample_data import ANTHONY_KEY

        assert anonymous_client.get(f'/api/students/{ANTHONY_KEY}').status_code == 401

    def test_a_rejected_request_leaks_no_data(self, anonymous_client):
        body = anonymous_client.get('/api/students').get_data(as_text=True)
        assert 'Nguyen' not in body
        assert 'student_key' not in body

    def test_the_challenge_names_the_scheme(self, anonymous_client):
        response = anonymous_client.get('/api/students')
        assert response.headers.get('WWW-Authenticate') == 'X-API-Key'


class TestCredentials:

    @pytest.mark.parametrize('key', [
        'wrong',
        '',
        TEST_API_KEY + 'x',        # right prefix, longer
        TEST_API_KEY[:-1],         # right prefix, truncated
        TEST_API_KEY.upper(),      # case must matter
        ' ' + TEST_API_KEY,        # not trimmed into validity
    ])
    def test_a_wrong_key_is_rejected(self, anonymous_client, key):
        response = anonymous_client.get('/api/students', headers={'X-API-Key': key})
        assert response.status_code == 401

    def test_the_header_name_is_what_it_says(self, anonymous_client):
        """The right value under the wrong header is still no credential."""
        response = anonymous_client.get(
            '/api/students', headers={'Authorization': TEST_API_KEY}
        )
        assert response.status_code == 401


class TestPublicEndpoints:

    def test_health_needs_no_credential(self, anonymous_client):
        """Liveness probes cannot carry secrets, and it reveals nothing."""
        response = anonymous_client.get('/api/health')
        assert response.status_code == 200
        assert response.get_json()['status'] == 'ok'

    def test_health_reveals_no_student_data(self, anonymous_client):
        body = anonymous_client.get('/api/health').get_json()
        assert set(body) == {'status', 'message'}

    def test_only_health_is_public(self):
        """A second entry here is a deliberate act, not something to add casually."""
        assert auth.PUBLIC_ENDPOINTS == {'metrics.health_check'}


class TestUnconfigured:

    def test_an_unset_key_closes_the_api_rather_than_opening_it(
        self, anonymous_client, monkeypatch
    ):
        """A missing API_KEY must cost availability, not disclosure. Answering 200 here
        would mean a deployment that forgot the variable serves student data openly."""
        monkeypatch.setattr(auth.config, 'API_KEY', None)

        response = anonymous_client.get('/api/students')
        assert response.status_code == 500
        assert 'not configured' in response.get_json()['error']

    def test_an_unset_key_cannot_be_matched_by_an_empty_header(
        self, anonymous_client, monkeypatch
    ):
        """Guard against `'' == ''` authenticating a caller against no configured key."""
        monkeypatch.setattr(auth.config, 'API_KEY', None)

        response = anonymous_client.get('/api/students', headers={'X-API-Key': ''})
        assert response.status_code != 200

    def test_health_survives_a_misconfigured_server(self, anonymous_client, monkeypatch):
        """Liveness must still answer, or the outage looks like a crash."""
        monkeypatch.setattr(auth.config, 'API_KEY', None)

        assert anonymous_client.get('/api/health').status_code == 200


class TestExtensibility:

    def test_a_second_authenticator_can_be_added_without_touching_the_routes(
        self, anonymous_client, monkeypatch
    ):
        """The seam for session cookies: the guard walks AUTHENTICATORS and stops at the
        first identity, so a browser mechanism is an append, not a rewrite."""
        monkeypatch.setattr(
            auth, 'AUTHENTICATORS', [lambda: {'kind': 'pretend_session'}]
        )
        assert anonymous_client.get('/api/students').status_code == 200

    def test_an_authenticator_that_recognises_nothing_still_closes_the_door(
        self, anonymous_client, monkeypatch
    ):
        monkeypatch.setattr(auth, 'AUTHENTICATORS', [lambda: None])
        assert anonymous_client.get('/api/students').status_code == 401


class TestPreflight:

    def test_a_cors_preflight_is_not_challenged(self, anonymous_client):
        """Preflight carries no credentials by design. A 401 here makes the browser
        report a CORS failure, hiding the real 401 the actual request would get."""
        response = anonymous_client.options(
            '/api/students',
            headers={
                'Origin': 'http://localhost:5173',
                'Access-Control-Request-Method': 'GET',
            },
        )
        assert response.status_code < 400


class TestUnknownRoutes:

    def test_a_missing_route_is_404_not_401(self, anonymous_client):
        """401-ing unknown paths turns the API into a probe for which routes exist."""
        assert anonymous_client.get('/api/no-such-route').status_code == 404
