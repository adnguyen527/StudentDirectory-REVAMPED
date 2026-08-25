"""A miniature student directory, shaped like the documents build_students.py writes.

The important property of this data is the household: ACCOUNT_NGUYEN carries two
siblings. Any query that filters on account_id alone will pull both of them, which is
exactly the bug the models are written to avoid, so most assertions lean on this pair.
"""

from datetime import datetime, timezone

from bson import ObjectId

ACCOUNT_NGUYEN = 'a1b2c3d4-0000-4000-8000-000000000001'
ACCOUNT_TAN = 'a1b2c3d4-0000-4000-8000-000000000002'

ANTHONY_KEY = f'{ACCOUNT_NGUYEN}_anthony-nguyen'
AVA_KEY = f'{ACCOUNT_NGUYEN}_ava-nguyen'
CHLOE_KEY = f'{ACCOUNT_TAN}_chloe-tan'

# Fixed ids so tests can assert on the student -> dwp_report links.
ANTHONY_DWP_IDS = [ObjectId('64b0000000000000000000a1'), ObjectId('64b0000000000000000000a2')]
AVA_DWP_IDS = [ObjectId('64b0000000000000000000b1')]
CHLOE_DWP_IDS = [ObjectId('64b0000000000000000000c1')]


def _utc(year, month, day):
    return datetime(year, month, day, tzinfo=timezone.utc)


STUDENTS = [
    {
        'student_key': ANTHONY_KEY,
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'centers': [{'name': 'Westside', 'sessions': 2}],
        'total_sessions': 2,
        'last_session_date': _utc(2026, 3, 14),
        'last_assessment': 'Algebra I',
        'total_pages_completed': 12,
        'instructors': [{'name': 'Dana Reyes', 'sessions': 2, 'pages_completed': 12}],
        'topics_mastered': [{'id': 'T-100', 'name': 'Fractions', 'times_mastered': 2}],
        'total_unique_topics_mastered': 1,
        'dwp_report_ids': ANTHONY_DWP_IDS,
        'last_modified': _utc(2026, 3, 15),
    },
    {
        'student_key': AVA_KEY,
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Ava Nguyen',
        'centers': [{'name': 'Westside', 'sessions': 1}],
        'total_sessions': 1,
        'last_session_date': _utc(2026, 3, 10),
        'last_assessment': 'Pre-Algebra',
        'total_pages_completed': 4,
        'instructors': [{'name': 'Dana Reyes', 'sessions': 1, 'pages_completed': 4}],
        'topics_mastered': [],
        'total_unique_topics_mastered': 0,
        'dwp_report_ids': AVA_DWP_IDS,
        'last_modified': _utc(2026, 3, 15),
    },
    {
        'student_key': CHLOE_KEY,
        'account_id': ACCOUNT_TAN,
        'student_name': 'Chloe Tan',
        'centers': [{'name': 'Eastside', 'sessions': 1}],
        'total_sessions': 1,
        'last_session_date': _utc(2026, 2, 1),
        'last_assessment': 'Geometry',
        'total_pages_completed': 7,
        'instructors': [{'name': 'Sam Ortiz', 'sessions': 1, 'pages_completed': 7}],
        'topics_mastered': [{'id': 'T-200', 'name': 'Angles', 'times_mastered': 1}],
        'total_unique_topics_mastered': 1,
        'dwp_report_ids': CHLOE_DWP_IDS,
        'last_modified': _utc(2026, 3, 15),
    },
]

DWP_REPORTS = [
    {
        '_id': ANTHONY_DWP_IDS[0],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'date': _utc(2026, 3, 7),
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'pages_completed': 5,
        'assessment': 'Algebra I',
        'topics': [{'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'}],
    },
    {
        '_id': ANTHONY_DWP_IDS[1],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'date': _utc(2026, 3, 14),
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'pages_completed': 7,
        'assessment': 'Algebra I',
        'topics': [{'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'}],
    },
    {
        '_id': AVA_DWP_IDS[0],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Ava Nguyen',
        'date': _utc(2026, 3, 10),
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'pages_completed': 4,
        'assessment': 'Pre-Algebra',
        'topics': [{'id': 'T-050', 'name': 'Counting', 'status': 'In Progress'}],
    },
    {
        '_id': CHLOE_DWP_IDS[0],
        'account_id': ACCOUNT_TAN,
        'student_name': 'Chloe Tan',
        'date': _utc(2026, 2, 1),
        'centers': ['Eastside'],
        'instructors': ['Sam Ortiz'],
        'pages_completed': 7,
        'assessment': 'Geometry',
        'topics': [{'id': 'T-200', 'name': 'Angles', 'status': 'Mastered'}],
    },
]

ATTENDANCE_REPORTS = [
    {'Account Id': ACCOUNT_NGUYEN, 'Student Name': 'Anthony Nguyen', 'Date': _utc(2026, 3, 7)},
    {'Account Id': ACCOUNT_NGUYEN, 'Student Name': 'Anthony Nguyen', 'Date': _utc(2026, 3, 14)},
    {'Account Id': ACCOUNT_NGUYEN, 'Student Name': 'Ava Nguyen', 'Date': _utc(2026, 3, 10)},
    {'Account Id': ACCOUNT_TAN, 'Student Name': 'Chloe Tan', 'Date': _utc(2026, 2, 1)},
]
