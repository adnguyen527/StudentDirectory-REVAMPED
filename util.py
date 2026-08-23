"""Helpers shared by the ingestion scripts and the API layer.

Student identity lives here so that ingestion and the models derive keys the same
way. If the key format changes, it changes in exactly one place.
"""

import re


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
