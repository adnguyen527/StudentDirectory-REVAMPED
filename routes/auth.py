"""Login, logout, and "who am I" -- the three routes a browser client needs.

There is no signup route. Staff accounts are created with scripts/create_user.py by
someone who already has access to the server; see models/user.py.

Every failure answers with the same body. Distinguishing "no such user" from "wrong
password" would turn this endpoint into a way to find out which usernames exist, and a
username is half of a credential.
"""

from flask import Blueprint, g, jsonify, request

from config import config
from models import LoginSession, User

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# One message for wrong password, unknown username, disabled account and locked account
# alike. The server knows the difference; the response does not admit it.
INVALID = {'error': 'Invalid username or password'}


def _public_user(identity):
    """What the frontend is allowed to know about the person it has logged in.

    An allowlist rather than the stored document minus a few fields: password_hash,
    failed_attempts and locked_until must never reach a response, and a projection that
    names what goes out cannot be widened by accident when the schema grows.
    """
    return {
        'username': identity['username'],
        'display_name': identity['display_name'],
    }


def _set_session_cookie(response, token):
    """HttpOnly so no script can read it -- including a script injected into our own
    page, which is the failure this actually guards against.

    Secure follows config, which follows HOST: a Secure cookie over plain http is
    silently dropped by the browser, so forcing it on would make local development look
    like a login that succeeds and then does nothing.
    """
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
    """End this session for real: the row is deleted, so the cookie stops working
    everywhere rather than just in the browser that discarded it.

    POST, not GET: a logout reachable by navigation can be triggered by any page that
    embeds the URL, and it is the one state change this API currently has.
    """
    LoginSession.revoke(request.cookies.get(config.SESSION_COOKIE_NAME))

    response = jsonify({'status': 'logged out'})
    # Same flags as when it was set. A delete_cookie whose attributes do not match the
    # ones the browser stored leaves the original cookie in place.
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
    """The current user, or 401.

    This is how the frontend decides between the app and the login page on a cold load:
    the cookie is HttpOnly, so JavaScript cannot inspect it and has to ask.
    """
    identity = getattr(g, 'identity', None)
    if identity is None or identity.get('kind') != 'session':
        # Reachable with a valid API key, which is an identity but not a person. Saying
        # so plainly beats inventing a user for a caller that does not have one.
        return jsonify({'error': 'Not a browser session'}), 401

    return jsonify({'user': _public_user(identity)}), 200
