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

    # Shared key for the X-API-Key header. Unset means the API answers 500 on every
    # protected route rather than serving student data unauthenticated -- see auth.py.
    API_KEY = os.getenv('API_KEY')

class DevelopmentConfig(Config):
    """Development configuration.

    DEBUG is deliberately NOT forced on here. This class is the default below, so
    hardcoding it would make the debugger the default state of the app rather than
    something FLASK_DEBUG=1 opts into.
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
