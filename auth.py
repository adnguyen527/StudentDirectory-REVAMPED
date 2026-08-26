"""Request authentication.

The API serves student names and staff commentary about named children, so every route
is closed by default and opened deliberately -- see PUBLIC_ENDPOINTS.

Today the only credential is a shared key in an X-API-Key header, which is enough for a
server-side caller. It is deliberately NOT enough for the planned React frontend: a key
shipped to a browser is readable in the bundle and in DevTools, so it is not a secret.
When that frontend arrives, add a session-cookie authenticator to AUTHENTICATORS rather
than reworking the routes -- the guard already walks a list and stops at the first
identity, so a second mechanism is an append, not a rewrite. Note that cookie auth also
requires a real ALLOWED_ORIGINS list, because browsers refuse to send credentials to a
wildcard origin.

Unconfigured means closed. If API_KEY is unset, protected routes answer 401 rather than
running open -- a misconfiguration should cost availability, not disclosure.
"""

import hmac

from flask import g, jsonify, request

from config import config


# Endpoints, not paths: a renamed route keeps its exemption, and a typo here fails closed
# instead of silently opening a path that no longer matches.
PUBLIC_ENDPOINTS = {
    'metrics.health_check',
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


# Ordered: the first authenticator to recognise the request wins. A session-cookie
# reader belongs here, after the key.
AUTHENTICATORS = [_api_key_identity]


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
        if not config.API_KEY:
            return jsonify({
                'error': 'Server is not configured for authentication',
                'detail': 'Set API_KEY in .env -- see .env.example',
            }), 500
        return jsonify({'error': 'Unauthorized'}), 401, {'WWW-Authenticate': 'X-API-Key'}

    g.identity = identity
    return None


def init_app(app):
    app.before_request(_guard)
