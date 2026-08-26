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


class Config:
    """Base configuration"""
    DEBUG = False
    TESTING = False
    JSON_SORT_KEYS = False

    # CORS settings
    CORS_HEADERS = 'Content-Type'
    ALLOWED_ORIGINS = parse_origins(os.getenv('ALLOWED_ORIGINS'))

    # Shared key for the X-API-Key header. Unset means the API answers 500 on every
    # protected route rather than serving student data unauthenticated -- see auth.py.
    API_KEY = os.getenv('API_KEY')

class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
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
