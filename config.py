import os
from dotenv import load_dotenv

load_dotenv()

# Vite and create-react-app defaults, on both spellings of the loopback address --
# browsers treat http://localhost:5173 and http://127.0.0.1:5173 as different origins.
DEFAULT_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
]


def parse_origins(value):
    """'http://a, http://b/' -> ['http://a', 'http://b']

    '*' is passed through as the string Flask-CORS wants for "any origin", but it has to
    be asked for by name: these routes serve student names and staff commentary, so the
    default is the local dev servers and nothing else.

    Trailing slashes are stripped because a browser's Origin header never has one, and a
    config entry that does would silently never match.
    """
    value = (value or '').strip()
    if value == '*':
        return '*'
    origins = [o.strip().rstrip('/') for o in value.split(',') if o.strip()]
    return origins or DEFAULT_ORIGINS


TRUTHY = {'1', 'true', 'yes', 'on'}


def parse_bool(value, default=False):
    """Anything unrecognised is False, deliberately.

    This decides whether the Werkzeug debugger runs, and the debugger is a Python console
    with the cluster credentials in reach. A typo in .env must fail towards off.
    """
    if value is None or str(value).strip() == '':
        return default
    return str(value).strip().lower() in TRUTHY


def parse_port(value, default=5000):
    try:
        port = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f'PORT must be a number, got {value!r}') from None
    if not 1 <= port <= 65535:
        raise ValueError(f'PORT must be between 1 and 65535, got {port}')
    return port


LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '::1'}


def parse_positive_int(value, default, name):
    """A count or a duration. Zero is refused with the negatives -- every caller here
    sets a limit, and zero means "no logins allowed" or "already expired"."""
    if value is None or str(value).strip() == '':
        return default
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be a whole number, got {value!r}') from None
    if parsed < 1:
        raise ValueError(f'{name} must be 1 or greater, got {parsed}')
    return parsed


class Config:
    """Base configuration"""
    # Off unless asked for. debug=True installs the interactive debugger, whose console
    # executes arbitrary Python in this process -- see the README.
    DEBUG = parse_bool(os.getenv('FLASK_DEBUG'))
    TESTING = False
    JSON_SORT_KEYS = False

    # Loopback unless asked otherwise. '0.0.0.0' binds every interface, which puts the
    # dev server on the local network.
    HOST = os.getenv('HOST', '127.0.0.1')
    PORT = parse_port(os.getenv('PORT') or 5000)

    # CORS settings
    CORS_HEADERS = 'Content-Type'
    ALLOWED_ORIGINS = parse_origins(os.getenv('ALLOWED_ORIGINS'))

    # For server-side callers. Unset is valid -- the API answers 401 -- but a server with
    # neither a key nor an account is unreachable, and app.py warns about that on startup.
    API_KEY = os.getenv('API_KEY')

    # --- Session authentication (see auth.py, models/login_session.py) ---

    SESSION_COOKIE_NAME = os.getenv('SESSION_COOKIE_NAME') or 'sd_session'

    # Absolute, not sliding: a sliding window writes to the database on every request.
    SESSION_TTL_HOURS = parse_positive_int(
        os.getenv('SESSION_TTL_HOURS'), 12, 'SESSION_TTL_HOURS'
    )

    # Loopback means http, where a Secure cookie is silently discarded and login never
    # works. Any other bind is a deployment, where it must not cross the network clear.
    SESSION_COOKIE_SECURE = parse_bool(
        os.getenv('SESSION_COOKIE_SECURE'), default=HOST not in LOOPBACK_HOSTS
    )

    # Lax, not Strict: Strict drops the cookie on inbound links, so arriving from a
    # bookmark would look like a logout. Lax still blocks the cross-site POST CSRF needs.
    SESSION_COOKIE_SAMESITE = 'Lax'

    # Werkzeug's default, spelled out. The ~100ms cost is the security property -- the
    # test suite lowers it for speed; NEVER lower it in a deployment.
    PASSWORD_HASH_METHOD = os.getenv('PASSWORD_HASH_METHOD') or 'scrypt:32768:8:1'

    # Accepted tradeoff: someone who knows a username can lock it for the window below,
    # which is cheaper than leaving the password endpoint unthrottled.
    LOGIN_MAX_ATTEMPTS = parse_positive_int(
        os.getenv('LOGIN_MAX_ATTEMPTS'), 10, 'LOGIN_MAX_ATTEMPTS'
    )
    LOGIN_LOCKOUT_MINUTES = parse_positive_int(
        os.getenv('LOGIN_LOCKOUT_MINUTES'), 15, 'LOGIN_LOCKOUT_MINUTES'
    )

class DevelopmentConfig(Config):
    """Development configuration.

    DEBUG is deliberately not forced on: this class is the default, so hardcoding it
    would make the debugger the app's default state rather than an opt-in.
    """
    ENV = 'development'

class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    ENV = 'production'

class TestingConfig(Config):
    """Testing configuration"""
    TESTING = True
    ENV = 'testing'

# Default to development
config = DevelopmentConfig()
