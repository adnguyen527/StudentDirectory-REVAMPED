"""Server-side login sessions -- what a browser cookie actually refers to.

Named LoginSession, on a `login_sessions` collection, because "session" already means
something else everywhere in this codebase: a tutoring session, the thing `dwp_reports`
holds one of and `total_sessions` counts. A collection called `sessions` sitting beside
those would be read wrong by every future reader, including us.

**Server-side, so that logging out means something.** The alternative -- signing the user
id into the cookie itself -- needs no collection and no lookup, but a stolen cookie stays
valid until it expires, logout only clears the browser's copy, and the sole way to revoke
anything is to rotate a secret and log everyone out. The README's "nothing to audit and
nothing to revoke" issue is exactly that gap, so the row is the point.

**Only the fingerprint is stored.** The cookie carries 32 random bytes; the collection
holds their SHA-256. Someone reading the database gets nothing they can present as a
credential. No stretching is needed here and none is used -- unlike a password, the token
is full-entropy random, so there is nothing for a brute-force to shortcut.

**No signing secret exists.** A random token validated by lookup needs no key, so there
is no SECRET_KEY to configure, leak, or rotate.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING

from config import config
from database import db

# 32 bytes of os.urandom. Guessing one is not a threat model at this size; the reason to
# say so is that it is what lets the lookup be a plain equality check with no rate limit.
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
        # Cleanup only -- see identity(). MongoDB's TTL monitor sweeps about once a
        # minute, so this bounds how long dead rows linger, not whether they are honoured.
        LoginSession._collection().create_index(
            [('expires_at', ASCENDING)], expireAfterSeconds=0
        )

    @staticmethod
    def create(user_id):
        """Open a session for this user and return the raw token, once.

        The raw value is returned rather than stored, so this is the only moment it
        exists anywhere but the caller's cookie.
        """
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

        Expiry is enforced **in the query**, not left to the TTL index. The index is a
        janitor: MongoDB sweeps on roughly a one-minute cycle and mongomock does not
        sweep at all, so a row that has passed its expires_at is routinely still sitting
        there. Trusting the index would mean an expired session that still authenticates,
        and the offline tests would never catch it.

        Comparing inside the query also sidesteps BSON's missing timezone -- the two
        datetimes meet in the database, not in Python.
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
