"""Request authentication. Every route is closed unless listed in PUBLIC_ENDPOINTS.

Two credentials, tried in order:

1. A session cookie, for the browser frontend -- issued by /api/auth/login, validated
   against `login_sessions`.
2. An X-API-Key header, for server-side callers. Never usable from a browser: a key in
   the bundle is readable by anyone who opens DevTools.

Sessions come first so a browser carrying both is identified as the person, not as the
anonymous shared key. Cookie auth needs an explicit ALLOWED_ORIGINS -- browsers refuse
credentials to a wildcard, and app.py refuses to start on that combination.
"""

import hmac

from flask import g, jsonify, request

from config import config
from models import LoginSession, User


# Endpoint names, not paths, so a typo fails closed rather than opening a stale path.
# Logout is deliberately absent: it needs the session it destroys, and an unauthenticated
# one would let anyone delete sessions by guessing.
PUBLIC_ENDPOINTS = {
    'metrics.health_check',
    'auth.login',
}


def _session_identity():
    """The staff account behind the session cookie, or None.

    The user is re-read on every request rather than copied into the session row, so
    disabling an account takes effect immediately instead of at expiry.
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
        # Rides along so the frontend user menu costs no extra request.
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
        # The challenge names the key, not the cookie: a script author can act on it,
        # while a browser client ignores it and goes to the login page.
        return jsonify({'error': 'Unauthorized'}), 401, {'WWW-Authenticate': 'X-API-Key'}

    g.identity = identity
    return None


def init_app(app):
    app.before_request(_guard)
