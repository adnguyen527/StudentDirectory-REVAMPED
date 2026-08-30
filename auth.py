"""Request authentication.

The API serves student names and staff commentary about named children, so every route
is closed by default and opened deliberately -- see PUBLIC_ENDPOINTS.

Two credentials, in this order:

1. **A session cookie**, for the browser frontend. Issued by /api/auth/login against a
   real staff account and validated by a lookup in `login_sessions`.
2. **A shared key** in an X-API-Key header, for server-side callers and scripts. It is
   deliberately NOT usable from a browser: a key shipped to the frontend is readable in
   the bundle and in DevTools, so it is not a secret once it gets there.

The guard walks AUTHENTICATORS and stops at the first identity, which is what made
adding the cookie an append rather than a rewrite. Sessions come first so that a browser
carrying both is identified as the person rather than as the anonymous shared key --
the whole point of having accounts is that the logs can name someone.

Unconfigured means closed: no credential is a 401, never a fallthrough. Note that cookie
auth requires a real ALLOWED_ORIGINS list, because browsers refuse to send credentials
to a wildcard origin -- app.py refuses to start on that combination.
"""

import hmac

from flask import g, jsonify, request

from config import config
from models import LoginSession, User


# Endpoints, not paths: a renamed route keeps its exemption, and a typo here fails closed
# instead of silently opening a path that no longer matches.
#
# Logout is NOT here. It needs the session it is destroying, and an unauthenticated
# logout would be a way to delete other people's sessions by guessing.
PUBLIC_ENDPOINTS = {
    'metrics.health_check',
    'auth.login',
}


def _session_identity():
    """The staff account behind the session cookie, or None.

    The user is loaded on every request rather than copied into the session row at login.
    That is a second indexed lookup on a collection of a handful of documents, and it
    buys two things a denormalised copy would not: disabling an account takes effect on
    the next request instead of at the end of their session, and a renamed display name
    is not stale until they log out.
    """
    session = LoginSession.find(request.cookies.get(config.SESSION_COOKIE_NAME))
    if session is None:
        return None

    user = User.find_by_id(session['user_id'])
    if user is None or user.get('disabled'):
        return None

    return {
        'kind': 'session',
        'user_id': user['_id'],
        'username': user['username'],
        # Carried on the identity because the frontend's user menu wants it on every
        # page, and this way it costs no extra request.
        'display_name': user.get('display_name') or user['username'],
    }


def _api_key_identity():
    """The X-API-Key header, compared in constant time.

    compare_digest rather than ==: a plain comparison returns as soon as two bytes
    differ, and the time it takes leaks how much of the key was guessed correctly.
    """
    configured = config.API_KEY
    provided = request.headers.get('X-API-Key', '')
    if not configured or not provided:
        return None
    if hmac.compare_digest(str(provided), str(configured)):
        return {'kind': 'api_key'}
    return None


# Ordered: the first authenticator to recognise the request wins.
AUTHENTICATORS = [_session_identity, _api_key_identity]


def authenticate():
    """The identity behind this request, or None."""
    for authenticator in AUTHENTICATORS:
        identity = authenticator()
        if identity is not None:
            return identity
    return None


def _guard():
    # CORS preflight carries no credentials by design -- rejecting it would make the
    # browser report a CORS failure instead of the 401 the real request will get.
    if request.method == 'OPTIONS':
        return None
    if request.endpoint in PUBLIC_ENDPOINTS:
        return None
    # An unmatched path is a 404, and 401-ing it first would turn this API into a probe
    # for which routes exist.
    if request.endpoint is None:
        return None

    identity = authenticate()
    if identity is None:
        # 401 for every failure, including an unset API_KEY. That used to be a 500 on the
        # reasoning that a server nobody configured should cost availability rather than
        # disclosure -- but a deployment serving only the browser frontend has no reason
        # to set a shared key at all, so treating that as an error would report a correct
        # configuration as broken. Both answers are closed; this one is also accurate.
        # app.py warns at startup about the case that really is unreachable: no key AND
        # no accounts.
        #
        # The challenge still names the key and not the cookie, because it is advice for
        # whoever can act on it: a script author can add a header, while a browser client
        # never reads this -- it sees the 401 and goes to the login page.
        return jsonify({'error': 'Unauthorized'}), 401, {'WWW-Authenticate': 'X-API-Key'}

    g.identity = identity
    return None


def init_app(app):
    app.before_request(_guard)
