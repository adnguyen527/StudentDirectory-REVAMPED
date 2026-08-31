"""Login, logout and "who am I" -- the three routes a browser client needs.

There is no signup route; accounts come from scripts/create_user.py.
"""

from flask import Blueprint, g, jsonify, request

from config import config
from models import LoginSession, User

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# One message for wrong password, unknown username, disabled and locked alike -- telling
# them apart would reveal which usernames exist.
INVALID = {'error': 'Invalid username or password'}


def _public_user(identity):
    """The fields a logged-in user may see about themselves.

    An allowlist, so password_hash and the lockout counters cannot leak into a response
    when the schema grows.
    """
    return {
        'username': identity['username'],
        'display_name': identity['display_name'],
    }


def _set_session_cookie(response, token):
    """HttpOnly, and Secure only when HOST is non-loopback -- a Secure cookie over plain
    http is silently dropped, which would break local development."""
    response.set_cookie(
        config.SESSION_COOKIE_NAME,
        token,
        max_age=config.SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=config.SESSION_COOKIE_SECURE,
        samesite=config.SESSION_COOKIE_SAMESITE,
        path='/',
    )
    return response


@auth_bp.route('/login', methods=['POST'])
def login():
    """Exchange credentials for a session cookie. The one public write endpoint."""
    payload = request.get_json(silent=True) or {}
    username = payload.get('username')
    password = payload.get('password')

    if not username or not password:
        return jsonify(INVALID), 401

    user = User.verify(username, password)
    if user is None:
        return jsonify(INVALID), 401

    token = LoginSession.create(user['_id'])

    response = jsonify({'user': {
        'username': user['username'],
        'display_name': user.get('display_name') or user['username'],
    }})
    return _set_session_cookie(response, token), 200


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Delete the session row, so the cookie stops working everywhere.

    POST, not GET: a logout reachable by navigation can be fired by any page linking it.
    """
    LoginSession.revoke(request.cookies.get(config.SESSION_COOKIE_NAME))

    response = jsonify({'status': 'logged out'})
    # Flags must match the ones set, or the browser keeps the original cookie.
    response.delete_cookie(
        config.SESSION_COOKIE_NAME,
        path='/',
        httponly=True,
        secure=config.SESSION_COOKIE_SECURE,
        samesite=config.SESSION_COOKIE_SAMESITE,
    )
    return response, 200


@auth_bp.route('/me', methods=['GET'])
def me():
    """The current user, or 401 -- how the frontend chooses between the app and the
    login page on a cold load, since the HttpOnly cookie cannot be read by script."""
    identity = getattr(g, 'identity', None)
    if identity is None or identity.get('kind') != 'session':
        # An API key is an identity but not a person, so there is no user to return.
        return jsonify({'error': 'Not a browser session'}), 401

    return jsonify({'user': _public_user(identity)}), 200
