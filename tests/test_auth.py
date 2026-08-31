"""Request authentication.

The point of these is that the API is closed by default. A test that only checked "a
valid key works" would pass just as happily against an API that let everyone in, so most
of what follows is about what happens WITHOUT a credential.
"""

from datetime import datetime, timedelta, timezone

import pytest

import auth
from config import config
from models import LoginSession, User
from models.login_session import fingerprint
from tests.conftest import (
    TEST_API_KEY,
    TEST_DISPLAY_NAME,
    TEST_PASSWORD,
    TEST_USERNAME,
)

PROTECTED_PATHS = [
    '/api/students',
    '/api/students/search?q=nguyen',
    '/api/metrics',
]

INVALID_BODY = {'error': 'Invalid username or password'}


def login(client, username=TEST_USERNAME, password=TEST_PASSWORD):
    return client.post(
        '/api/auth/login', json={'username': username, 'password': password}
    )


def cookie_header(response):
    """The raw Set-Cookie string, so the flags can be asserted on rather than assumed.

    Read off the header instead of the client's jar: the jar reports the value, and the
    attributes are the half of this that carries the security properties.
    """
    return response.headers.get('Set-Cookie', '')


def cookie_value(response):
    return cookie_header(response).split(';')[0].split('=', 1)[1]


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

    def test_the_public_set_is_exactly_health_and_login(self):
        """An entry here is a deliberate act, not something to add casually.

        Login has to be public -- it is where a credential comes from. Logout does not
        and must not be: it needs the session it destroys, and an unauthenticated logout
        would be a way to delete other people's sessions by guessing at cookies.
        """
        assert auth.PUBLIC_ENDPOINTS == {'metrics.health_check', 'auth.login'}

    def test_login_is_reachable_without_a_credential(self, anonymous_client):
        """Rejected on the merits, not challenged at the door."""
        response = anonymous_client.post(
            '/api/auth/login', json={'username': 'nobody', 'password': 'wrong'}
        )
        assert response.status_code == 401
        assert response.get_json() == {'error': 'Invalid username or password'}

    def test_logout_is_not_public(self, anonymous_client):
        response = anonymous_client.post('/api/auth/logout')
        assert response.status_code == 401


class TestUnconfigured:

    def test_an_unset_key_closes_the_api_rather_than_opening_it(
        self, anonymous_client, monkeypatch
    ):
        """A missing API_KEY must cost availability, not disclosure. Answering 200 here
        would mean a deployment that forgot the variable serves student data openly.

        401 rather than an error: a server running only the browser frontend has no
        reason to set a shared key, so an unset one is valid. Closed either way.
        """
        monkeypatch.setattr(auth.config, 'API_KEY', None)

        response = anonymous_client.get('/api/students')
        assert response.status_code == 401
        assert 'Nguyen' not in response.get_data(as_text=True)

    def test_an_unset_key_does_not_describe_the_server_to_a_stranger(
        self, anonymous_client, monkeypatch
    ):
        """The old 500 told an unauthenticated caller which variable was missing. That
        belongs in the startup log, where only an operator sees it."""
        monkeypatch.setattr(auth.config, 'API_KEY', None)

        body = anonymous_client.get('/api/students').get_data(as_text=True)
        assert 'API_KEY' not in body
        assert '.env' not in body

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


# --------------------------------------------------------------------------------
# Session authentication
#
# The browser credential. Same principle as everything above: most of these are about
# what does NOT work, because a suite that only proved "logging in lets you in" would
# pass against a server that let everyone in.
# --------------------------------------------------------------------------------


class TestLogin:

    def test_valid_credentials_are_accepted(self, anonymous_client, staff_user):
        response = login(anonymous_client)
        assert response.status_code == 200
        assert response.get_json()['user'] == {
            'username': TEST_USERNAME,
            'display_name': TEST_DISPLAY_NAME,
        }

    def test_the_response_carries_no_hash_and_no_lockout_state(
        self, anonymous_client, staff_user
    ):
        """An allowlist, not the stored document minus a few fields -- so a schema that
        grows cannot widen this by accident."""
        assert set(login(anonymous_client).get_json()['user']) == {
            'username', 'display_name',
        }

    @pytest.mark.parametrize('username, password', [
        (TEST_USERNAME, 'wrong-password-entirely'),
        (TEST_USERNAME, TEST_PASSWORD + 'x'),     # right prefix, longer
        (TEST_USERNAME, TEST_PASSWORD[:-1]),      # right prefix, truncated
        (TEST_USERNAME, TEST_PASSWORD.upper()),   # case must matter
        (TEST_USERNAME, ''),
        ('no-such-person', TEST_PASSWORD),
        ('', TEST_PASSWORD),
    ])
    def test_bad_credentials_are_rejected(
        self, anonymous_client, staff_user, username, password
    ):
        response = login(anonymous_client, username, password)
        assert response.status_code == 401
        assert 'Set-Cookie' not in response.headers

    def test_every_failure_gives_the_same_answer(self, anonymous_client, staff_user):
        """Unknown username, wrong password and disabled account are indistinguishable
        in the response. Telling them apart makes this a way to discover which usernames
        exist, and a username is half of a credential."""
        User.create('disabled-account', TEST_PASSWORD)
        User.set_disabled('disabled-account', True)

        bodies = [
            login(anonymous_client, 'no-such-person', TEST_PASSWORD).get_json(),
            login(anonymous_client, TEST_USERNAME, 'wrong-password-entirely').get_json(),
            login(anonymous_client, 'disabled-account', TEST_PASSWORD).get_json(),
        ]
        assert bodies == [INVALID_BODY, INVALID_BODY, INVALID_BODY]

    def test_a_disabled_account_cannot_log_in(self, anonymous_client, staff_user):
        User.set_disabled(TEST_USERNAME, True)
        assert login(anonymous_client).status_code == 401

    def test_the_username_is_case_insensitive(self, anonymous_client, staff_user):
        """Stored folded, so the unique index means what it looks like it means."""
        assert login(anonymous_client, TEST_USERNAME.upper()).status_code == 200

    def test_a_malformed_body_is_rejected_not_crashed(self, anonymous_client, staff_user):
        for payload in ({}, {'username': TEST_USERNAME}, {'password': TEST_PASSWORD}):
            assert anonymous_client.post('/api/auth/login', json=payload).status_code == 401
        assert anonymous_client.post(
            '/api/auth/login', data='not json', content_type='application/json'
        ).status_code == 401

    def test_login_is_post_only(self, anonymous_client):
        assert anonymous_client.get('/api/auth/login').status_code == 405


class TestTheSessionCookie:

    def test_the_cookie_is_httponly(self, anonymous_client, staff_user):
        """The one flag that matters most here: a script cannot read it, including a
        script injected into our own page, which is the failure this guards against."""
        assert 'HttpOnly' in cookie_header(login(anonymous_client))

    def test_the_cookie_is_samesite_lax(self, anonymous_client, staff_user):
        """Lax blocks the cross-site POST that CSRF needs, which is what lets the token
        wait for the write endpoints. Strict would make arriving from a bookmark or a
        chat link look like a logout."""
        assert 'SameSite=Lax' in cookie_header(login(anonymous_client))

    def test_secure_follows_the_configuration(self, anonymous_client, staff_user):
        """Off here because tests bind loopback, where a Secure cookie over plain http
        is silently discarded and login would appear to succeed and do nothing."""
        assert config.SESSION_COOKIE_SECURE is False
        assert 'Secure' not in cookie_header(login(anonymous_client))

    def test_the_cookie_alone_reaches_a_protected_route(self, logged_in_client):
        """No API key on this client -- the browser path works end to end."""
        assert 'HTTP_X_API_KEY' not in logged_in_client.environ_base
        assert logged_in_client.get('/api/students').status_code == 200

    @pytest.mark.parametrize('path', PROTECTED_PATHS)
    def test_a_session_reaches_every_protected_route(self, logged_in_client, path):
        assert logged_in_client.get(path).status_code == 200

    def test_the_api_key_still_works(self, client):
        """AUTHENTICATORS is additive: adding the cookie did not remove the key that
        server-side callers use."""
        assert client.get('/api/students').status_code == 200

    @pytest.mark.parametrize('token', [
        'not-a-token',
        '',
        'a' * 43,                      # right shape, never issued
    ])
    def test_a_forged_cookie_is_rejected(self, anonymous_client, staff_user, token):
        anonymous_client.set_cookie(config.SESSION_COOKIE_NAME, token)
        assert anonymous_client.get('/api/students').status_code == 401

    def test_a_truncated_cookie_is_rejected(self, anonymous_client, staff_user):
        """A near-miss, not a random string: the stored id is a hash, so a token one
        character short shares no prefix with it and cannot partially match."""
        token = cookie_value(login(anonymous_client))
        anonymous_client.set_cookie(config.SESSION_COOKIE_NAME, token[:-1])
        assert anonymous_client.get('/api/students').status_code == 401


class TestSessionStorage:

    def test_the_token_itself_is_never_stored(self, anonymous_client, staff_user, mongo):
        """A database dump must not yield anything presentable as a credential."""
        token = cookie_value(login(anonymous_client))

        rows = list(mongo['login_sessions'].find({}))
        assert len(rows) == 1
        assert token not in repr(rows)
        assert rows[0]['_id'] == fingerprint(token)

    def test_expiry_is_enforced_by_the_query_not_the_ttl_index(
        self, logged_in_client, mongo
    ):
        """The index is a janitor, and the lookup does not rely on it having swept.

        Proved by taking the janitor away entirely -- dropping the collection, which is
        the only thing that removes mongomock's TTL behaviour -- and planting an expired
        row by hand. It stays there, and it is still refused.

        On a real cluster that state is routine rather than contrived: MongoDB's TTL
        monitor runs on a roughly one-minute cycle, so every session spends up to a
        minute expired and still stored. A lookup that trusted the index would
        authenticate for that minute.
        """
        token = 'a-planted-token'
        mongo.drop_collection('login_sessions')
        mongo['login_sessions'].insert_one({
            '_id': fingerprint(token),
            'user_id': mongo['users'].find_one({'username': TEST_USERNAME})['_id'],
            'created_at': datetime.now(timezone.utc) - timedelta(hours=13),
            'expires_at': datetime.now(timezone.utc) - timedelta(hours=1),
        })
        assert mongo['login_sessions'].count_documents({}) == 1, 'row was swept anyway'

        assert LoginSession.find(token) is None
        assert LoginSession.count_live() == 0

        logged_in_client.set_cookie(config.SESSION_COOKIE_NAME, token)
        assert logged_in_client.get('/api/students').status_code == 401

    def test_a_session_survives_up_to_its_expiry(self, logged_in_client, mongo):
        mongo['login_sessions'].update_many(
            {}, {'$set': {'expires_at': datetime.now(timezone.utc) + timedelta(hours=1)}}
        )
        assert logged_in_client.get('/api/students').status_code == 200

    def test_two_logins_are_two_sessions(self, anonymous_client, staff_user, mongo):
        """Independent rows, so signing out of one device does not sign out the other."""
        first = cookie_value(login(anonymous_client))
        second = cookie_value(login(anonymous_client))

        assert first != second
        assert mongo['login_sessions'].count_documents({}) == 2

    def test_disabling_an_account_ends_its_live_sessions(
        self, logged_in_client, mongo
    ):
        """The reason the user is loaded on every request rather than copied into the
        session row at login: this takes effect immediately, not at expiry."""
        assert logged_in_client.get('/api/students').status_code == 200

        User.set_disabled(TEST_USERNAME, True)

        assert logged_in_client.get('/api/students').status_code == 401

    def test_revoke_all_clears_every_session_for_one_user(
        self, anonymous_client, staff_user, mongo
    ):
        other = User.create('someone-else', TEST_PASSWORD)
        login(anonymous_client)
        login(anonymous_client)
        LoginSession.create(other['_id'])

        assert LoginSession.revoke_all_for(staff_user['_id']) == 2
        assert mongo['login_sessions'].count_documents({}) == 1


class TestLogout:

    def test_logout_revokes_the_session_not_just_the_browser_copy(
        self, logged_in_client, mongo
    ):
        """The whole reason sessions are server-side. Replaying the same cookie after
        logout must fail -- a signed-cookie scheme would still accept it."""
        token = None
        for cookie in logged_in_client.get_cookie(config.SESSION_COOKIE_NAME),:
            token = cookie.value

        assert logged_in_client.post('/api/auth/logout').status_code == 200
        assert mongo['login_sessions'].count_documents({}) == 0

        logged_in_client.set_cookie(config.SESSION_COOKIE_NAME, token)
        assert logged_in_client.get('/api/students').status_code == 401

    def test_logout_clears_the_cookie(self, logged_in_client):
        header = cookie_header(logged_in_client.post('/api/auth/logout'))
        assert config.SESSION_COOKIE_NAME in header
        assert 'Expires=Thu, 01 Jan 1970' in header

    def test_the_client_is_logged_out_afterwards(self, logged_in_client):
        logged_in_client.post('/api/auth/logout')
        assert logged_in_client.get('/api/students').status_code == 401

    def test_logging_out_twice_is_not_an_error(self, logged_in_client):
        """Idempotent -- but the second call is unauthenticated by then, which is the
        401 rather than a 500."""
        assert logged_in_client.post('/api/auth/logout').status_code == 200
        assert logged_in_client.post('/api/auth/logout').status_code == 401

    def test_one_logout_does_not_end_another_session(
        self, anonymous_client, staff_user, mongo
    ):
        first = cookie_value(login(anonymous_client))
        login(anonymous_client)                      # the client now holds the second

        anonymous_client.post('/api/auth/logout')

        anonymous_client.set_cookie(config.SESSION_COOKIE_NAME, first)
        assert anonymous_client.get('/api/students').status_code == 200


class TestWhoAmI:

    def test_me_is_401_without_a_session(self, anonymous_client):
        """How the frontend decides between the app and the login page on a cold load:
        the cookie is HttpOnly, so JavaScript cannot look and has to ask."""
        assert anonymous_client.get('/api/auth/me').status_code == 401

    def test_me_names_the_logged_in_user(self, logged_in_client):
        response = logged_in_client.get('/api/auth/me')
        assert response.status_code == 200
        assert response.get_json()['user'] == {
            'username': TEST_USERNAME,
            'display_name': TEST_DISPLAY_NAME,
        }

    def test_an_api_key_is_an_identity_but_not_a_person(self, client):
        """The shared key authenticates a caller, not someone with a name. Inventing a
        user for it would be a lie the frontend then displays."""
        response = client.get('/api/auth/me')
        assert response.status_code == 401
        assert response.get_json() == {'error': 'Not a browser session'}

    def test_me_leaks_no_credential_material(self, logged_in_client):
        body = logged_in_client.get('/api/auth/me').get_data(as_text=True)
        assert 'password' not in body.lower()
        assert 'locked' not in body.lower()


class TestLoginThrottling:

    def test_the_account_locks_after_the_configured_attempts(
        self, anonymous_client, staff_user, monkeypatch
    ):
        monkeypatch.setattr(config, 'LOGIN_MAX_ATTEMPTS', 3)

        for _ in range(3):
            assert login(anonymous_client, password='wrong-password').status_code == 401

        # Correct password, still refused -- the lockout is the point.
        assert login(anonymous_client).status_code == 401

    def test_a_lockout_expires(self, anonymous_client, staff_user, monkeypatch, mongo):
        monkeypatch.setattr(config, 'LOGIN_MAX_ATTEMPTS', 3)
        for _ in range(3):
            login(anonymous_client, password='wrong-password')

        mongo['users'].update_one(
            {'username': TEST_USERNAME},
            {'$set': {'locked_until': datetime.now(timezone.utc) - timedelta(hours=1)}},
        )
        assert login(anonymous_client).status_code == 200

    def test_guessing_during_a_lockout_does_not_extend_it(
        self, anonymous_client, staff_user, monkeypatch, mongo
    ):
        """Otherwise continued guessing keeps a real user out for as long as it lasts,
        which turns the throttle into a denial of service anyone can trigger."""
        monkeypatch.setattr(config, 'LOGIN_MAX_ATTEMPTS', 3)
        for _ in range(3):
            login(anonymous_client, password='wrong-password')

        locked_until = mongo['users'].find_one({'username': TEST_USERNAME})['locked_until']
        for _ in range(3):
            login(anonymous_client, password='wrong-password')

        after = mongo['users'].find_one({'username': TEST_USERNAME})['locked_until']
        assert after == locked_until

    def test_a_successful_login_clears_the_counter(
        self, anonymous_client, staff_user, monkeypatch, mongo
    ):
        monkeypatch.setattr(config, 'LOGIN_MAX_ATTEMPTS', 3)
        login(anonymous_client, password='wrong-password')
        login(anonymous_client, password='wrong-password')

        assert login(anonymous_client).status_code == 200
        assert mongo['users'].find_one({'username': TEST_USERNAME})['failed_attempts'] == 0

    def test_a_lockout_is_indistinguishable_from_a_wrong_password(
        self, anonymous_client, staff_user, monkeypatch
    ):
        monkeypatch.setattr(config, 'LOGIN_MAX_ATTEMPTS', 1)
        login(anonymous_client, password='wrong-password')

        assert login(anonymous_client).get_json() == INVALID_BODY


class TestUserRecords:

    def test_the_password_is_never_stored(self, staff_user, mongo):
        stored = mongo['users'].find_one({'username': TEST_USERNAME})
        assert TEST_PASSWORD not in repr(stored)
        assert stored['password_hash'].startswith('scrypt:')

    @pytest.mark.parametrize('password, complaint', [
        ('a1b', 'at least 6'),          # too short, has a digit
        ('', 'at least 6'),
        (None, 'at least 6'),
        ('abcdefgh', 'one number'),     # long enough, no digit
        ('password', 'one number'),
    ])
    def test_a_password_below_the_policy_is_refused(
        self, seeded_db, password, complaint
    ):
        with pytest.raises(ValueError, match=complaint):
            User.create('someone', password)

    def test_the_floor_is_six_characters_with_a_digit(self, seeded_db):
        """The rejections above pass just as happily against a rule that refuses
        everything. This is the one that pins where the line actually sits."""
        User.create('someone', 'abcde1')
        assert User.verify('someone', 'abcde1') is not None

    def test_set_password_enforces_the_same_rule_as_create(self, staff_user):
        """Guards the drift a shared validator exists to prevent: a reset path that
        accepts what the create path rejects."""
        with pytest.raises(ValueError, match='one number'):
            User.set_password(TEST_USERNAME, 'abcdefgh')
        with pytest.raises(ValueError, match='at least 6'):
            User.set_password(TEST_USERNAME, 'a1b')

        # And the original password still works -- a rejected reset changed nothing.
        assert User.verify(TEST_USERNAME, TEST_PASSWORD) is not None

    def test_usernames_are_unique(self, staff_user, seeded_db):
        from pymongo.errors import DuplicateKeyError

        with pytest.raises(DuplicateKeyError):
            User.create(TEST_USERNAME.upper(), TEST_PASSWORD)

    def test_no_role_field_is_stored(self, staff_user, mongo):
        """Deliberate: nothing reads a role until per-user permissions exist, and a
        field with no consumer is a promise the code does not keep."""
        assert 'role' not in mongo['users'].find_one({'username': TEST_USERNAME})

    def test_verify_returns_none_for_an_unknown_user(self, seeded_db):
        assert User.verify('nobody-at-all', TEST_PASSWORD) is None

    def test_resetting_a_password_clears_the_lockout(self, staff_user, mongo):
        """An administrator resetting a password is resolving exactly the situation a
        lockout creates."""
        mongo['users'].update_one(
            {'username': TEST_USERNAME},
            {'$set': {'locked_until': datetime.now(timezone.utc) + timedelta(hours=1)}},
        )
        User.set_password(TEST_USERNAME, 'a-different-password-1')

        assert User.verify(TEST_USERNAME, 'a-different-password-1') is not None


class TestCorsAndCredentials:

    def test_a_wildcard_origin_refuses_to_start(self, monkeypatch):
        """Browsers do not send cookies to Access-Control-Allow-Origin: *, so this
        combination does not degrade -- it logs in and is then anonymous on every
        request, with no error anywhere. Failing at startup is the debuggable version."""
        from app import create_app

        monkeypatch.setattr(config, 'ALLOWED_ORIGINS', '*')
        with pytest.raises(RuntimeError, match='wildcard'):
            create_app()

    def test_the_preflight_allows_credentials(self, anonymous_client):
        response = anonymous_client.options(
            '/api/auth/login',
            headers={
                'Origin': 'http://localhost:5173',
                'Access-Control-Request-Method': 'POST',
            },
        )
        assert response.status_code < 400
        assert response.headers.get('Access-Control-Allow-Credentials') == 'true'

    def test_an_unlisted_origin_is_not_granted_credentials(self, anonymous_client):
        response = anonymous_client.options(
            '/api/auth/login',
            headers={
                'Origin': 'http://evil.example.com',
                'Access-Control-Request-Method': 'POST',
            },
        )
        assert 'Access-Control-Allow-Origin' not in response.headers
