"""Student identity. Ingestion and the API both derive keys here, so a change in
behaviour silently orphans every document already written with the old format."""

import pytest

from tests.sample_data import ACCOUNT_NGUYEN
from util import make_student_key, slug, split_student_key


@pytest.mark.parametrize('value,expected', [
    ('Anthony Williams', 'anthony-williams'),
    ('ANTHONY WILLIAMS', 'anthony-williams'),
    ("Brian O'Connor", 'brian-o-connor'),
    ('Mary-Jane  Smith', 'mary-jane-smith'),
    ('  Padded Name  ', 'padded-name'),
    ('José Álvarez', 'jos-lvarez'),      # non-ASCII is dropped, not transliterated
    ('Student #3', 'student-3'),
    ('!!!', ''),
    (12345, '12345'),                    # ints arrive straight from Excel cells
])
def test_slug(value, expected):
    assert slug(value) == expected


def test_slug_never_emits_an_underscore():
    """split_student_key() partitions on the first underscore, so the name half must
    not contain one."""
    assert '_' not in slug('First_Last Name_2')


def test_make_student_key_combines_account_and_name():
    assert make_student_key(ACCOUNT_NGUYEN, 'Anthony Nguyen') == (
        f'{ACCOUNT_NGUYEN}_anthony-nguyen'
    )


def test_make_student_key_separates_siblings():
    assert make_student_key(ACCOUNT_NGUYEN, 'Anthony Nguyen') != make_student_key(
        ACCOUNT_NGUYEN, 'Ava Nguyen'
    )


def test_make_student_key_is_stable_across_name_formatting():
    """The same student typed three ways must land on one profile."""
    keys = {
        make_student_key(ACCOUNT_NGUYEN, name)
        for name in ['Anthony Nguyen', 'anthony nguyen', '  ANTHONY   NGUYEN ']
    }
    assert len(keys) == 1


@pytest.mark.parametrize('name', [
    'Anthony Nguyen',
    "Brian O'Connor",
    'Mary-Jane Smith',
    'Student #3',
])
def test_split_student_key_round_trips(name):
    key = make_student_key(ACCOUNT_NGUYEN, name)
    account_id, name_slug = split_student_key(key)
    assert account_id == ACCOUNT_NGUYEN
    assert name_slug == slug(name)


def test_split_student_key_on_a_key_without_a_separator():
    account_id, name_slug = split_student_key('bare-account-id')
    assert (account_id, name_slug) == ('bare-account-id', '')
