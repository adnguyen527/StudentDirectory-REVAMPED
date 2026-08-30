"""Helpers shared by the ingestion scripts and the API layer.

Student identity lives here so that ingestion and the models derive keys the same
way. If the key format changes, it changes in exactly one place.
"""

import re
from datetime import timezone


def as_utc(value):
    """A datetime read back from the database, made safe to compare against now().

    BSON has no timezone: pymongo stores UTC and hands the value back naive, while
    mongomock returns the aware datetime it was given. Comparing the two spellings
    raises TypeError, so anything read back is normalised here before it meets a
    `datetime.now(timezone.utc)`.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def slug(value):
    """'Anthony Williams' -> 'anthony-williams'"""
    return re.sub(r'[^a-z0-9]+', '-', str(value).lower()).strip('-')


def make_student_key(account_id, student_name):
    """Stable, URL-safe identity for one student.

    account_id identifies a household, not a student, so it is not sufficient on its
    own -- 191 accounts carry 2-5 siblings.
    """
    return f"{account_id}_{slug(student_name)}"


def split_student_key(student_key):
    """Inverse of make_student_key -> (account_id, name_slug).

    account_ids are UUIDs (hyphens, never underscores) and slug() never emits an
    underscore, so the first underscore is always the separator.
    """
    account_id, _, name_slug = str(student_key).partition('_')
    return account_id, name_slug
