"""Shared test fixtures.

Unit tests run against an in-memory mongomock server, never a real cluster. The real
MONGODB_URI is read once here and then replaced with an unroutable sentinel, so a test
that slips past the mongomock patch fails to connect instead of touching production
data. The opt-in integration tests in test_live_database.py use the captured real URI.
"""

import os
import re
import sys
from pathlib import Path

import mongomock
import pytest
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / '.env')

REAL_URI = os.getenv('MONGODB_URI')
REAL_DB_NAME = os.getenv('MONGODB_DB', 'StudentDirectory')

# Assigned, not setdefault-ed: an exported MONGODB_URI in the developer's shell would
# otherwise survive and become the unit tests' connection target.
os.environ['MONGODB_URI'] = 'mongodb://unit-tests.invalid:27017/'
os.environ['MONGODB_DB'] = 'StudentDirectoryTest'

# Set before config is imported, so the app under test is configured rather than
# answering 500 on every protected route.
TEST_API_KEY = 'test-api-key-not-a-real-secret'
os.environ['API_KEY'] = TEST_API_KEY

import database  # noqa: E402  -- must follow the env setup above
from database import Database  # noqa: E402

from tests.sample_data import (  # noqa: E402
    ATTENDANCE_REPORTS,
    DWP_REPORTS,
    INSTRUCTORS,
    STUDENTS,
)


def pytest_addoption(parser):
    parser.addoption(
        '--integration',
        action='store_true',
        default=False,
        help='also run the read-only checks against the real MongoDB cluster',
    )


def pytest_collection_modifyitems(config, items):
    """Integration tests are opt-in: they need network and real credentials."""
    if config.getoption('--integration'):
        return
    skip = pytest.mark.skip(reason='needs --integration')
    for item in items:
        if 'integration' in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope='session')
def live_db():
    """Read-only handle on the real cluster, for the --integration checks."""
    if not REAL_URI:
        pytest.skip('MONGODB_URI is not set')
    if re.search(r'[<>]', REAL_URI):
        # .env still holds the .env.example placeholders -- a config gap, not a data
        # problem, so say so plainly instead of failing twelve integrity checks.
        pytest.skip('MONGODB_URI still contains <placeholders>; fill in .env')

    from pymongo import MongoClient

    client = MongoClient(REAL_URI, serverSelectionTimeoutMS=10_000)
    client.admin.command('ping')
    yield client[REAL_DB_NAME]
    client.close()


@pytest.fixture(autouse=True)
def mongo(monkeypatch):
    """Swap pymongo for mongomock and hand back a clean, empty database.

    Database caches its client and db on the class, so state leaks between tests unless
    it is reset on both sides of the test.
    """
    Database.close()
    Database._client = None
    Database._db = None

    monkeypatch.setattr(database, 'MongoClient', mongomock.MongoClient)

    yield Database.get_db()

    Database._client = None
    Database._db = None


@pytest.fixture
def seeded_db(mongo):
    """The empty database, populated with the sample directory."""
    mongo['students'].create_index('student_key', unique=True)
    mongo['students'].insert_many(STUDENTS)
    mongo['instructors'].create_index('instructor_name', unique=True)
    mongo['instructors'].insert_many(INSTRUCTORS)
    mongo['dwp_reports'].insert_many(DWP_REPORTS)
    mongo['attendance_reports'].insert_many(ATTENDANCE_REPORTS)
    return mongo


@pytest.fixture
def anonymous_client(seeded_db):
    """Test client that sends no credentials -- for the auth tests themselves."""
    from app import create_app

    app = create_app()
    app.config['TESTING'] = True
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture
def client(anonymous_client):
    """Authenticated test client wired to the seeded in-memory database.

    Every route but /api/health requires a credential, so the default client carries one
    and the tests below stay about behaviour rather than about authentication.
    """
    anonymous_client.environ_base['HTTP_X_API_KEY'] = TEST_API_KEY
    return anonymous_client
