"""A miniature student directory, shaped like the documents build_students.py writes.

The important property of this data is the household: ACCOUNT_NGUYEN carries two
siblings. Any query that filters on account_id alone will pull both of them, which is
exactly the bug the models are written to avoid, so most assertions lean on this pair.

The second property is the co-taught session: Anthony's 3/14 was run by two instructors,
so its 7 pages are credited to each of them in full. Summing pages across INSTRUCTORS
therefore overshoots the pages actually recorded, exactly as it does on the real data.
"""

from datetime import datetime

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


def _day(year, month, day):
    """Midnight on a date, timezone-naive.

    Naive on purpose: import_reports parses dates with strptime, and MongoDB stores
    UTC and hands datetimes back naive unless the client asks otherwise. A tz-aware
    fixture would not compare equal to what a query returns.
    """
    return datetime(year, month, day)


STUDENTS = [
    {
        'student_key': ANTHONY_KEY,
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'centers': [{'name': 'Westside', 'sessions': 2}],
        'total_sessions': 2,
        'last_session_date': _day(2026, 3, 14),
        'last_assessment': 'Algebra I',
        'total_pages_completed': 12,
        'instructors': [
            # Six sessions, one of them never finalized: above the display threshold,
            # and the 60/5 average differs from the 60/6 a naive divide would give.
            {'name': 'Dana Reyes', 'sessions': 6, 'finalized_sessions': 5,
             'pages_completed': 60},
            # Below the threshold, so no rate is shown for them.
            {'name': 'Marcus Reyes', 'sessions': 1, 'finalized_sessions': 1,
             'pages_completed': 7},
        ],
        # Two topics over two sessions: Fractions climbs the ladder, Decimals was
        # mastered on 3/7 and handed straight back on 3/14 -- assigned a second time.
        'topics': [
            {'id': 'T-110', 'name': 'Decimals', 'sessions': 2,
             'times_worked_on': 1, 'times_completed': 0, 'times_mastered': 1,
             'times_assigned': 2, 'first_seen': _day(2026, 3, 7),
             'last_seen': _day(2026, 3, 14),
             'last_assignment_started': _day(2026, 3, 14),
             'status': 'Worked On', 'state': 'on_plan'},
            {'id': 'T-100', 'name': 'Fractions', 'sessions': 2,
             'times_worked_on': 1, 'times_completed': 0, 'times_mastered': 1,
             'times_assigned': 1, 'first_seen': _day(2026, 3, 7),
             'last_seen': _day(2026, 3, 14),
             'last_assignment_started': _day(2026, 3, 7),
             'status': 'Mastered', 'state': 'finished'},
        ],
        'total_unique_topics_mastered': 2,
        'total_unique_topics_completed': 0,
        # Both were mastered, neither was ever written as Completed -- which is exactly
        # why the finished count cannot be read off total_unique_topics_completed.
        'total_unique_topics_finished': 2,
        'total_topic_reassignments': 1,
        'total_topics_on_plan': 1,
        'total_topics_removed': 0,
        'dwp_report_ids': ANTHONY_DWP_IDS,
        'last_modified': _day(2026, 3, 15),
    },
    {
        'student_key': AVA_KEY,
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Ava Nguyen',
        'centers': [{'name': 'Westside', 'sessions': 1}],
        'total_sessions': 1,
        'last_session_date': _day(2026, 3, 10),
        'last_assessment': 'Pre-Algebra',
        'total_pages_completed': 4,
        'instructors': [
            {'name': 'Dana Reyes', 'sessions': 1, 'finalized_sessions': 1,
             'pages_completed': 4},
        ],
        # Her one topic carries a status outside the ladder, so nothing is rolled up.
        'topics': [],
        'total_unique_topics_mastered': 0,
        'total_unique_topics_completed': 0,
        'total_unique_topics_finished': 0,
        'total_topic_reassignments': 0,
        'total_topics_on_plan': 0,
        'total_topics_removed': 0,
        'dwp_report_ids': AVA_DWP_IDS,
        'last_modified': _day(2026, 3, 15),
    },
    {
        'student_key': CHLOE_KEY,
        'account_id': ACCOUNT_TAN,
        'student_name': 'Chloe Tan',
        'centers': [{'name': 'Eastside', 'sessions': 1}],
        'total_sessions': 1,
        'last_session_date': _day(2026, 2, 1),
        'last_assessment': 'Geometry',
        'total_pages_completed': 7,
        'instructors': [
            {'name': 'Sam Ortiz', 'sessions': 1, 'finalized_sessions': 1,
             'pages_completed': 7},
        ],
        # Completed but not mastered -- the rarest of the three states, 398 pairs live.
        'topics': [
            {'id': 'T-200', 'name': 'Angles', 'sessions': 1,
             'times_worked_on': 0, 'times_completed': 1, 'times_mastered': 0,
             'times_assigned': 1, 'first_seen': _day(2026, 2, 1),
             'last_seen': _day(2026, 2, 1),
             'last_assignment_started': _day(2026, 2, 1),
             'status': 'Completed', 'state': 'finished'},
        ],
        'total_unique_topics_mastered': 0,
        'total_unique_topics_completed': 1,
        'total_unique_topics_finished': 1,
        'total_topic_reassignments': 0,
        'total_topics_on_plan': 0,
        'total_topics_removed': 0,
        'dwp_report_ids': CHLOE_DWP_IDS,
        'last_modified': _day(2026, 3, 15),
    },
]

DWP_REPORTS = [
    {
        '_id': ANTHONY_DWP_IDS[0],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'date': _day(2026, 3, 7),
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'pages_completed': 5,
        'assessment': 'Algebra I',
        'topics': [
            {'id': 'T-100', 'name': 'Fractions', 'status': 'Worked On'},
            {'id': 'T-110', 'name': 'Decimals', 'status': 'Mastered'},
        ],
    },
    {
        '_id': ANTHONY_DWP_IDS[1],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Anthony Nguyen',
        'date': _day(2026, 3, 14),
        'centers': ['Westside'],
        # Co-taught: both instructors are credited the full 7 pages.
        'instructors': ['Dana Reyes', 'Marcus Reyes'],
        'pages_completed': 7,
        'assessment': 'Algebra I',
        # Decimals goes backwards: mastered on 3/7, reassigned a week later.
        'topics': [
            {'id': 'T-100', 'name': 'Fractions', 'status': 'Mastered'},
            {'id': 'T-110', 'name': 'Decimals', 'status': 'Worked On'},
        ],
    },
    {
        '_id': AVA_DWP_IDS[0],
        'account_id': ACCOUNT_NGUYEN,
        'student_name': 'Ava Nguyen',
        'date': _day(2026, 3, 10),
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'pages_completed': 4,
        'assessment': 'Pre-Algebra',
        'topics': [{'id': 'T-050', 'name': 'Counting', 'status': 'In Progress'}],
    },
    {
        # Carries every private field, in both spellings the source has used, so the
        # projection is tested against what it is actually meant to withhold.
        '_id': CHLOE_DWP_IDS[0],
        'account_id': ACCOUNT_TAN,
        'lead_id': 'lead-0002',
        'row_hash': 'deadbeef',
        'internal_notes': 'parent behind on payment',
        'notes_from_center_director': 'move to the 4pm slot',
        'notes_for_center_director': 'older spelling, still populated on 3,655 rows',
        # Not private -- her own profile serves this. The report list does not, which is
        # the one difference between the two projections.
        'student_notes': 'gets discouraged when a page runs long',
        'session_summary_notes': 'worked through angle pairs',
        'student_name': 'Chloe Tan',
        'date': _day(2026, 2, 1),
        'centers': ['Eastside'],
        'instructors': ['Sam Ortiz'],
        'pages_completed': 7,
        'assessment': 'Geometry',
        'topics': [{'id': 'T-200', 'name': 'Angles', 'status': 'Completed'}],
    },
]

# Shaped like the documents build_instructors.py writes. Dana and Marcus share a
# surname so that a name search can return more than one of them, and share the 3/14
# session so that co_taught_sessions is not uniformly zero.
INSTRUCTORS = [
    {
        'instructor_name': 'Dana Reyes',
        'total_sessions_taught': 3,
        'co_taught_sessions': 1,
        'unfinalized_sessions': 0,
        'total_pages_completed': 16,
        'days_taught': [_day(2026, 3, 7), _day(2026, 3, 10), _day(2026, 3, 14)],
        'last_session_date': _day(2026, 3, 14),
        'students': [
            {'student_key': ANTHONY_KEY, 'student_name': 'Anthony Nguyen',
             'sessions': 2, 'pages_completed': 12},
            {'student_key': AVA_KEY, 'student_name': 'Ava Nguyen',
             'sessions': 1, 'pages_completed': 4},
        ],
        'topics': [
            {'topic_id': 'T-110', 'name': 'Decimals', 'sessions': 2},
            {'topic_id': 'T-100', 'name': 'Fractions', 'sessions': 2},
        ],
        # Two centers, mirroring the 11 of 103 real instructors who work at more than
        # one: ticking both must return her once, not twice.
        'centers': [{'name': 'Westside', 'sessions': 2}, {'name': 'Eastside', 'sessions': 1}],
        'last_modified': _day(2026, 3, 15),
    },
    {
        'instructor_name': 'Marcus Reyes',
        'total_sessions_taught': 1,
        'co_taught_sessions': 1,
        'unfinalized_sessions': 0,
        'total_pages_completed': 7,
        'days_taught': [_day(2026, 3, 14)],
        'last_session_date': _day(2026, 3, 14),
        'students': [
            {'student_key': ANTHONY_KEY, 'student_name': 'Anthony Nguyen',
             'sessions': 1, 'pages_completed': 7},
        ],
        'topics': [{'topic_id': 'T-100', 'name': 'Fractions', 'sessions': 1}],
        'centers': [{'name': 'Westside', 'sessions': 1}],
        'last_modified': _day(2026, 3, 15),
    },
    {
        'instructor_name': 'Sam Ortiz',
        'total_sessions_taught': 1,
        'co_taught_sessions': 0,
        'unfinalized_sessions': 0,
        'total_pages_completed': 7,
        'days_taught': [_day(2026, 2, 1)],
        'last_session_date': _day(2026, 2, 1),
        'students': [
            {'student_key': CHLOE_KEY, 'student_name': 'Chloe Tan',
             'sessions': 1, 'pages_completed': 7},
        ],
        'topics': [{'topic_id': 'T-200', 'name': 'Angles', 'sessions': 1}],
        'centers': [{'name': 'Eastside', 'sessions': 1}],
        'last_modified': _day(2026, 3, 15),
    },
]


# The program-wide rollup, carrying the two traps the real collection has. `T-115` shares
# its name with `T-110`: 90 names are held by more than one topic id on the cluster, which
# is why the list sorts on (name, topic_id) rather than name alone. `T-100` carries an
# also_known_as, the renamed case -- searching "Halves" has to find a topic now called
# "Fractions", or keeping the names not chosen buys nothing.
TOPICS = [
    {
        'topic_id': 'T-100',
        'name': 'Fractions',
        'also_known_as': ['Halves and Quarters'],
        'sessions': 3,
        'times_worked_on': 1,
        'times_completed': 0,
        'times_mastered': 2,
        'unique_students': 2,
        'students_finished': 2,
        'students_mastered': 1,
        'students_on_plan': 0,
        'students_removed': 0,
        'students_ever_finished': 2,
        'total_reassignments': 0,
        'median_sessions_to_finish': 1.5,
        'instructors': [
            {'name': 'Dana Reyes', 'sessions': 2},
            {'name': 'Marcus Reyes', 'sessions': 1},
        ],
        'first_taught': _day(2026, 3, 7),
        'last_taught': _day(2026, 3, 14),
        'last_modified': _day(2026, 3, 15),
    },
    {
        'topic_id': 'T-110',
        'name': 'Decimals',
        'also_known_as': [],
        'sessions': 2,
        'times_worked_on': 1,
        'times_completed': 0,
        'times_mastered': 1,
        'unique_students': 1,
        'students_finished': 1,
        'students_mastered': 1,
        'students_on_plan': 0,
        'students_removed': 0,
        'students_ever_finished': 1,
        'total_reassignments': 1,
        'median_sessions_to_finish': 2,
        'instructors': [{'name': 'Dana Reyes', 'sessions': 2}],
        'first_taught': _day(2026, 3, 7),
        'last_taught': _day(2026, 3, 14),
        'last_modified': _day(2026, 3, 15),
    },
    {
        'topic_id': 'T-115',
        'name': 'Decimals',
        'also_known_as': [],
        'sessions': 1,
        'times_worked_on': 1,
        'times_completed': 0,
        'times_mastered': 0,
        'unique_students': 1,
        'students_finished': 0,
        'students_mastered': 0,
        'students_on_plan': 1,
        'students_removed': 0,
        'students_ever_finished': 0,
        'total_reassignments': 0,
        'median_sessions_to_finish': None,
        'instructors': [],
        'first_taught': _day(2026, 2, 1),
        'last_taught': _day(2026, 2, 1),
        'last_modified': _day(2026, 3, 15),
    },
    {
        'topic_id': 'T-200',
        'name': 'Angles',
        'also_known_as': [],
        'sessions': 1,
        'times_worked_on': 0,
        'times_completed': 1,
        'times_mastered': 0,
        'unique_students': 1,
        'students_finished': 1,
        'students_mastered': 0,
        'students_on_plan': 0,
        'students_removed': 0,
        'students_ever_finished': 1,
        'total_reassignments': 0,
        'median_sessions_to_finish': 1,
        'instructors': [{'name': 'Sam Ortiz', 'sessions': 1}],
        'first_taught': _day(2026, 2, 1),
        'last_taught': _day(2026, 2, 1),
        'last_modified': _day(2026, 3, 15),
    },
]


def _attendance(student_key, account_id, name, day, sessions=1, **overrides):
    doc = {
        'student_key': student_key,
        'account_id': account_id,
        'student_name': name,
        'date': day,
        'sessions': sessions,
        'sessions_timed': sessions,
        'centers': ['Westside'],
        'instructors': ['Dana Reyes'],
        'delivery_methods': ['In-Center'],
        'pages_completed': 5,
        'minutes_present': 60,
        'first_session_start': day.replace(hour=16),
        'last_session_end': day.replace(hour=17),
        'dwp_report_ids': [],
        'last_modified': _day(2026, 3, 15),
    }
    doc.update(overrides)
    return doc


# One document per student-day. Anthony's 3/14 is the multi-session case: two sessions,
# one day -- counting rows would call it two days of attendance.
ATTENDANCE_REPORTS = [
    _attendance(ANTHONY_KEY, ACCOUNT_NGUYEN, 'Anthony Nguyen', _day(2026, 3, 7)),
    _attendance(
        ANTHONY_KEY, ACCOUNT_NGUYEN, 'Anthony Nguyen', _day(2026, 3, 14),
        sessions=2, pages_completed=7, minutes_present=95,
        instructors=['Dana Reyes', 'Marcus Reyes'],
        last_session_end=_day(2026, 3, 14).replace(hour=19),
    ),
    _attendance(AVA_KEY, ACCOUNT_NGUYEN, 'Ava Nguyen', _day(2026, 3, 10), pages_completed=4),
    _attendance(
        CHLOE_KEY, ACCOUNT_TAN, 'Chloe Tan', _day(2026, 2, 1),
        centers=['Eastside'], instructors=['Sam Ortiz'],
        delivery_methods=['@Home'], pages_completed=7,
        # No trustworthy session_end on this day, so presence was never measured.
        sessions_timed=0, minutes_present=None, last_session_end=None,
    ),
]
