"""Server-side login sessions -- what a browser cookie refers to.

Named LoginSession rather than Session because "session" already means a tutoring
session throughout this codebase (`dwp_reports`, `total_sessions`).

Sessions are rows, not signed cookies, so logout can actually revoke one. Only the
token's SHA-256 is stored, so a database dump yields nothing presentable as a credential.
No signing secret is involved -- a random token validated by lookup needs no key.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING

from config import config
from database import db

TOKEN_BYTES = 32


def fingerprint(token):
    """The stored form of a token. Never reversible, never a credential itself."""
    return hashlib.sha256(str(token).encode('utf-8')).hexdigest()


class LoginSession:

    @staticmethod
    def _collection():
        return db.get_db()['login_sessions']

    @staticmethod
    def ensure_indexes():
        # Cleanup only -- expiry is enforced in find().
        LoginSession._collection().create_index(
            [('expires_at', ASCENDING)], expireAfterSeconds=0
        )

    @staticmethod
    def create(user_id):
        """Open a session and return the raw token -- the only time it exists outside
        the caller's cookie."""
        token = secrets.token_urlsafe(TOKEN_BYTES)
        now = datetime.now(timezone.utc)
        LoginSession._collection().insert_one({
            '_id': fingerprint(token),
            'user_id': user_id,
            'created_at': now,
            'expires_at': now + timedelta(hours=config.SESSION_TTL_HOURS),
        })
        return token

    @staticmethod
    def find(token):
        """The live session row for this token, or None.

        Expiry is checked here, not left to the TTL index: Mongo sweeps on a ~1min cycle
        and mongomock not at all, so expired rows are routinely still stored.
        """
        if not token:
            return None
        return LoginSession._collection().find_one({
            '_id': fingerprint(token),
            'expires_at': {'$gt': datetime.now(timezone.utc)},
        })

    @staticmethod
    def revoke(token):
        """Delete the row. Idempotent -- logging out twice is not an error."""
        if not token:
            return False
        result = LoginSession._collection().delete_one({'_id': fingerprint(token)})
        return result.deleted_count == 1

    @staticmethod
    def revoke_all_for(user_id):
        """Every session this user holds. For a disabled account or a leaked cookie."""
        return LoginSession._collection().delete_many(
            {'user_id': user_id}
        ).deleted_count

    @staticmethod
    def count_live():
        return LoginSession._collection().count_documents(
            {'expires_at': {'$gt': datetime.now(timezone.utc)}}
        )
