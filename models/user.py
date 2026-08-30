"""Staff accounts -- the identity behind a browser session.

No signup route by design: accounts are created by an administrator running
scripts/create_user.py. Passwords are hashed with werkzeug's scrypt; the plaintext is
never stored, logged, or returned.

Deliberately absent: a role or permissions field, until something reads it.
"""

from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING
from werkzeug.security import check_password_hash, generate_password_hash

from config import config
from database import db
from util import as_utc

# The password policy, in one place -- every caller goes through validate_password().
#
# A low bar, for a small internal tool where an operator sets every password by hand. It
# leans on scrypt's cost and the lockout in verify(); it does NOT cover an offline attack
# if the collection leaks. Raise this if that stops being an acceptable trade.
MIN_PASSWORD_LENGTH = 6

_dummy_hash = None


def validate_password(password):
    """Raise ValueError unless the password meets the policy.

    Raises rather than returning a boolean, so a caller cannot accept a bad password by
    forgetting to check.
    """
    password = password or ''
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f'password must be at least {MIN_PASSWORD_LENGTH} characters'
        )
    if not any(character.isdigit() for character in password):
        raise ValueError('password must contain at least one number')
    return password


def _dummy():
    """A real hash no password can match, so an unknown username costs the same time as
    a wrong password rather than answering faster and revealing itself.

    Built on first use, not at import: scrypt takes ~100ms and every script imports this.
    """
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = generate_password_hash(
            'this string is never a valid password', method=config.PASSWORD_HASH_METHOD
        )
    return _dummy_hash


def normalize_username(username):
    """Fold to lowercase, so the unique index means what it looks like -- otherwise
    'Anthony' and 'anthony' are two accounts."""
    return str(username or '').strip().lower()


class User:

    @staticmethod
    def _collection():
        return db.get_db()['users']

    @staticmethod
    def ensure_indexes():
        User._collection().create_index([('username', ASCENDING)], unique=True)

    @staticmethod
    def find_by_username(username):
        return User._collection().find_one({'username': normalize_username(username)})

    @staticmethod
    def find_by_id(user_id):
        return User._collection().find_one({'_id': user_id})

    @staticmethod
    def count_all():
        return User._collection().count_documents({})

    @staticmethod
    def create(username, password, display_name=None):
        """A new account. Raises DuplicateKeyError if the username is taken."""
        username = normalize_username(username)
        if not username:
            raise ValueError('username is required')
        validate_password(password)

        document = {
            'username': username,
            'password_hash': generate_password_hash(
                password, method=config.PASSWORD_HASH_METHOD
            ),
            'display_name': (display_name or '').strip() or username,
            'disabled': False,
            'created_at': datetime.now(timezone.utc),
            'last_login_at': None,
            'failed_attempts': 0,
            'locked_until': None,
        }
        User._collection().insert_one(document)
        return document

    @staticmethod
    def set_password(username, password):
        """Also clears the lockout -- a reset resolves the situation it exists for."""
        validate_password(password)
        result = User._collection().update_one(
            {'username': normalize_username(username)},
            {'$set': {
                'password_hash': generate_password_hash(
                    password, method=config.PASSWORD_HASH_METHOD
                ),
                'failed_attempts': 0,
                'locked_until': None,
            }},
        )
        return result.matched_count == 1

    @staticmethod
    def set_disabled(username, disabled):
        result = User._collection().update_one(
            {'username': normalize_username(username)},
            {'$set': {'disabled': bool(disabled)}},
        )
        return result.matched_count == 1

    @staticmethod
    def verify(username, password):
        """The account behind these credentials, or None.

        One return value for every failure -- unknown, wrong, disabled, locked -- so a
        caller cannot tell them apart and reveal which usernames exist.
        """
        user = User.find_by_username(username)

        # Runs before any check can return: the hashing has to cost the same whether or
        # not the account exists, or the timing answers the question.
        matches = check_password_hash(
            user['password_hash'] if user else _dummy(), password or ''
        )

        if user is None or user.get('disabled'):
            return None

        now = datetime.now(timezone.utc)
        locked_until = as_utc(user.get('locked_until'))
        if locked_until and locked_until > now:
            # Not counted as a further failure, or guessing would extend the lockout
            # indefinitely and keep a real user out.
            return None

        if not matches:
            User._record_failure(user, now)
            return None

        User._collection().update_one(
            {'_id': user['_id']},
            {'$set': {
                'last_login_at': now,
                'failed_attempts': 0,
                'locked_until': None,
            }},
        )
        return user

    @staticmethod
    def _record_failure(user, now):
        """Count the failure, and lock the account once the ceiling is reached."""
        # Read-then-set rather than $inc, so the lock decision and the write agree.
        attempts = int(user.get('failed_attempts') or 0) + 1
        update = {'failed_attempts': attempts}
        if attempts >= config.LOGIN_MAX_ATTEMPTS:
            update['locked_until'] = now + timedelta(
                minutes=config.LOGIN_LOCKOUT_MINUTES
            )
            update['failed_attempts'] = 0
        User._collection().update_one({'_id': user['_id']}, {'$set': update})
