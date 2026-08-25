"""The connection manager: one client, reused, and reopenable after close."""

import mongomock
import pytest

import database
from database import Database


def test_connect_returns_the_configured_database():
    db = Database.connect()
    assert db.name == 'StudentDirectoryTest'


def test_connect_is_idempotent():
    """A second connect() must reuse the client rather than opening another."""
    Database.connect()
    first = Database._client
    Database.connect()
    assert Database._client is first


def test_get_db_connects_lazily():
    Database._client = None
    Database._db = None
    assert Database.get_db() is not None
    assert Database._client is not None


class DeadClient:
    """Constructs fine, fails the ping -- how an unreachable Atlas cluster behaves,
    since MongoClient() itself does not open a socket."""

    def __init__(self, *args, **kwargs):
        pass

    @property
    def admin(self):
        raise ConnectionError('ping failed')

    def close(self):
        pass


def test_connect_pings_before_handing_back_a_database(monkeypatch):
    """A client that constructs but cannot ping must raise, not look connected."""
    monkeypatch.setattr(database, 'MongoClient', DeadClient)
    Database._client = None
    Database._db = None

    with pytest.raises(ConnectionError):
        Database.connect()

    assert Database._db is None
    assert Database._client is None


def test_failed_connect_does_not_leak_a_broken_client(monkeypatch):
    """A client that never pinged must not stay cached: the guard in connect() would
    short-circuit every later attempt, and get_db() would hand back None for the rest
    of the process instead of retrying once the cluster came back."""
    monkeypatch.setattr(database, 'MongoClient', DeadClient)
    Database._client = None
    Database._db = None

    with pytest.raises(ConnectionError):
        Database.connect()

    monkeypatch.setattr(database, 'MongoClient', mongomock.MongoClient)
    assert Database.get_db() is not None


def test_close_clears_state_and_allows_reconnect():
    Database.connect()
    Database.close()

    assert Database._client is None
    assert Database._db is None
    assert Database.get_db() is not None


def test_close_is_safe_when_never_connected():
    Database._client = None
    Database._db = None
    Database.close()  # must not raise


def test_module_level_instance_shares_the_class_state():
    """models/ import the `db` instance; routes exercise the class. Same connection."""
    assert database.db.get_db() is Database.get_db()
