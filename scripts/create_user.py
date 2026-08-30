"""
Create and maintain the staff accounts that can log into the API.

There is no signup route by design; this script is the only way an account is made.

The password is prompted for, never taken as an argument -- an argument lands in shell
history and in the process list. `--password-stdin` covers automation.

    python scripts/create_user.py anthony                    # create, prompting twice
    python scripts/create_user.py anthony --name "Anthony N" # set the display name
    python scripts/create_user.py anthony --reset-password   # new password, clears lockout
    python scripts/create_user.py anthony --disable          # revokes live sessions too
    python scripts/create_user.py anthony --enable
    python scripts/create_user.py --list
    ... --password-stdin < secret.txt                        # unattended; no confirmation
"""

import argparse
import getpass
import sys
from pathlib import Path

# Repo root, one level up.
sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo.errors import DuplicateKeyError

from database import db
from models import LoginSession, User
from models.user import validate_password


def read_password(from_stdin=False):
    """The new password, prompted for or piped in.

    Prompting asks twice, since a typo locks someone out of an account with no
    self-service reset; --password-stdin has one value to read, so it cannot confirm.
    getpass reads the console, not stdin, which is why the flag exists at all.
    """
    if from_stdin:
        password = sys.stdin.readline().rstrip('\n')
    else:
        password = getpass.getpass('Password: ')

    # The model's rule, not a copy of it -- a second spelling here would drift.
    try:
        validate_password(password)
    except ValueError as e:
        sys.exit(f'[!!] {str(e).capitalize()}.')

    if not from_stdin and password != getpass.getpass('Confirm password: '):
        sys.exit('[!!] Passwords did not match. Nothing was changed.')
    return password


def list_users():
    users = list(User._collection().find({}, {'password_hash': 0}).sort('username', 1))
    if not users:
        print('No accounts. Create one: python scripts/create_user.py <username>')
        return
    print(f'{len(users)} account(s):')
    for user in users:
        state = 'disabled' if user.get('disabled') else 'active'
        last = user.get('last_login_at') or 'never'
        sessions = LoginSession._collection().count_documents({'user_id': user['_id']})
        print(
            f"  {user['username']:<20} {state:<9} "
            f"last login: {last}  live sessions: {sessions}"
        )


def main():
    # Raw, or argparse collapses the docstring's whitespace and renders the usage
    # examples above as one unreadable paragraph.
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('username', nargs='?', help='account to create or modify')
    parser.add_argument('--name', help='display name, shown in the frontend user menu')
    parser.add_argument('--reset-password', action='store_true')
    # Mutually exclusive at parse time, so a contradictory command is rejected before
    # the script opens a connection to the cluster.
    state = parser.add_mutually_exclusive_group()
    state.add_argument('--disable', action='store_true')
    state.add_argument('--enable', action='store_true')
    parser.add_argument('--list', action='store_true', help='list accounts and exit')
    parser.add_argument(
        '--password-stdin', action='store_true',
        help='read the password from stdin instead of prompting (no confirmation)',
    )
    args = parser.parse_args()

    db.connect()
    User.ensure_indexes()
    LoginSession.ensure_indexes()

    if args.list:
        return list_users()

    if not args.username:
        parser.error('a username is required (or use --list)')

    existing = User.find_by_username(args.username)

    if args.disable or args.enable:
        if not existing:
            sys.exit(f'[!!] No such account: {args.username}')
        User.set_disabled(args.username, args.disable)
        if args.disable:
            # Belt and braces. _session_identity() already refuses a disabled account on
            # the next request, but deleting the rows means the cookie is dead rather
            # than merely useless, and it frees the sessions immediately.
            revoked = LoginSession.revoke_all_for(existing['_id'])
            print(f'[ok] Disabled {args.username}; revoked {revoked} live session(s).')
        else:
            print(f'[ok] Enabled {args.username}.')
        return

    if args.reset_password:
        if not existing:
            sys.exit(f'[!!] No such account: {args.username}')
        User.set_password(args.username, read_password(args.password_stdin))
        # Deliberately NOT revoking here: an administrator rotating a forgotten password
        # is not responding to a compromise. Use --disable then --enable for that.
        print(f'[ok] Password reset for {args.username}. Lockout cleared.')
        return

    if existing:
        sys.exit(
            f'[!!] {args.username} already exists. Use --reset-password, --disable or '
            '--enable.'
        )

    password = read_password(args.password_stdin)
    try:
        User.create(args.username, password, display_name=args.name)
    except DuplicateKeyError:
        # Between the check above and this insert. Rare, but the index is the authority.
        sys.exit(f'[!!] {args.username} already exists.')
    except ValueError as e:
        sys.exit(f'[!!] {e}')

    print(f'[ok] Created account {args.username}.')


if __name__ == '__main__':
    main()
