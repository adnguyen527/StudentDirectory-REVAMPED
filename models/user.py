"""Staff accounts -- the identity behind a browser session.

There is no signup route and there should not be one. Every account in here is created
deliberately by an administrator running scripts/create_user.py; the API serves student
names and staff commentary about named children, so the set of people who can read it is
a decision, not a form.

Passwords are hashed with werkzeug's default (scrypt), which ships with Flask -- nothing
new to install and nothing hand-rolled. The plaintext is never stored, never logged, and
never leaves this module.

Deliberately absent: a role or permissions field. Nothing would read it until per-user
permissions are built, and a field with no consumer is a promise the code does not keep.
Adding one to a collection this small is a single migration when that day comes.
"""

from datetime import datetime, timedelta, timezone

from pymongo import ASCENDING
from werkzeug.security import check_password_hash, generate_password_hash

from config import config
from database import db
from util import as_utc

# The password policy, in one place. Every caller goes through validate_password() rather
# than checking length itself -- the rule used to be spelled out at three call sites, and
# the CLI's copy is exactly the sort of thing that drifts from the model's.
#
# Six characters and a digit is a deliberately low bar, chosen for a small internal tool
# where the operator sets every password by hand. What it leans on: scrypt makes each
# guess expensive, and the lockout in verify() caps online guessing at ten attempts per
# fifteen minutes. What it does not cover is an OFFLINE attack -- if login_sessions and
# users ever leak, a six-character password does not survive long against a GPU. Raise
# MIN_PASSWORD_LENGTH here if that ever stops being an acceptable trade.
MIN_PASSWORD_LENGTH = 6

_dummy_hash = None


def validate_password(password):
    """Raise ValueError unless the password meets the policy. Returns it unchanged.

    Raises rather than returning a boolean so a caller cannot accept a bad password by
    forgetting to check the result.
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
    """A real hash that no password can match, for the unknown-username case.

    verify() runs check_password_hash against this when the account does not exist, so
    an unknown username costs the same time as a wrong password. Without it the endpoint
    answers noticeably faster for names that are not registered, which is a username
    oracle -- the same reasoning as the constant-time key comparison in auth.py.

    Built on first use rather than at import: scrypt takes ~100ms by design, and every
    ingestion script imports this package.
    """
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = generate_password_hash(
            'this string is never a valid password', method=config.PASSWORD_HASH_METHOD
        )
    return _dummy_hash


def normalize_username(username):
    """Usernames are matched case-insensitively, so they are stored folded.

    Doing it here rather than at each call site is what makes the unique index mean
    what it looks like it means -- otherwise 'Anthony' and 'anthony' are two accounts.
    """
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
        """A new account. Raises DuplicateKeyError if the username is taken.

        display_name is what the frontend's user menu shows; it falls back to the
        username so the column is never empty.
        """
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
        """Also clears the lockout: an administrator resetting a password is resolving
        exactly the situation a lockout exists to create."""
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

        One return value for every kind of failure -- unknown, wrong, disabled, locked.
        The caller cannot accidentally tell them apart in a response, which is what
        keeps the login endpoint from enumerating which usernames exist.
        """
        user = User.find_by_username(username)

        # Unconditional, and before any of the checks below can return: the work has to
        # happen whether or not the account exists, or the timing answers the question.
        matches = check_password_hash(
            user['password_hash'] if user else _dummy(), password or ''
        )

        if user is None or user.get('disabled'):
            return None

        now = datetime.now(timezone.utc)
        locked_until = as_utc(user.get('locked_until'))
        if locked_until and locked_until > now:
            # Not counted as another failure: retrying during a lockout would otherwise
            # extend it indefinitely, so a wrong guess could keep a real user out for
            # as long as the guessing continued.
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
        # Counted from the stored value rather than $inc-ed blindly, so the lock decision
        # and the write agree on the same number.
        attempts = int(user.get('failed_attempts') or 0) + 1
        update = {'failed_attempts': attempts}
        if attempts >= config.LOGIN_MAX_ATTEMPTS:
            update['locked_until'] = now + timedelta(
                minutes=config.LOGIN_LOCKOUT_MINUTES
            )
            update['failed_attempts'] = 0
        User._collection().update_one({'_id': user['_id']}, {'$set': update})
