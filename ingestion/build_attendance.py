"""
Build the attendance_reports collection by collapsing dwp_reports into student-days.

A DWP row is a session, not a visit. 70 of the 29,311 student-days in the current data
carry more than one row (69 with two, 1 with three), so counting rows overstates
attendance by exactly those extra sessions. One document here is one student on one
date, whatever number of sessions that took.

Keyed by (student_key, date). account_id identifies a household, so a sibling pair
attending the same day would collapse into a single record if the date were paired with
the account instead of the student.

@Home sessions are attendance too and are kept, tagged by delivery_method rather than
filtered out -- 723 of 29,382 rows are @Home. An in-center-only view is
`find({'delivery_methods': 'In-Center'})`; the reverse is not recoverable from a
collection that dropped them at build time.

`minutes_present` sums each session's own duration rather than spanning first start to
last end, so a student who came in twice with a three-hour gap is not credited with the
gap. Times that cannot be trusted are left out of the sum and counted in `sessions_timed`:
217 rows have no session_end at all, and a handful of pairs end before they start.

Session times arrive from dwp_reports as datetimes, so this builder no longer reconstructs
them from clock strings and a date -- see combine_session_time in import_reports.py.

Safe to re-run -- drops and rebuilds the target collection each time.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING
from mongo_url import uri, db_name
from util import make_student_key
# Absolute, unlike the bare imports in the script-only backfills: the tests import this
# module as ingestion.build_attendance, and only the repo root is on sys.path then.
from ingestion.import_reports import combine_session_time


TARGET_COLLECTION = 'attendance_reports'

# A session longer than this is a data error, not a long day: the longest plausible
# stretch at a center. Such pairs are excluded from minutes_present rather than
# inflating it.
MAX_SESSION_MINUTES = 12 * 60


def session_time(session_date, value):
    """One session time as a datetime.

    dwp_reports stores these as datetimes; combine_session_time passes those straight
    through and rebuilds one from a clock string for any row imported before that was
    true, so a build run before backfill_session_datetimes.py still produces the same
    answer.
    """
    return combine_session_time(session_date, value)


def session_minutes(start, end):
    """Length of one session, or None if the pair cannot be trusted."""
    if start is None or end is None:
        return None
    minutes = (end - start).total_seconds() / 60
    # Negative means the pair is wrong (or crossed midnight, which no session here
    # does); either way it is not a length.
    if minutes < 0 or minutes > MAX_SESSION_MINUTES:
        return None
    return int(minutes)


def build_attendance():
    client = MongoClient(uri)
    db = client[db_name]
    dwp_collection = db['dwp_reports']
    attendance_collection = db[TARGET_COLLECTION]

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports into '{TARGET_COLLECTION}'...")

    days = {}
    skipped = 0
    untimed_sessions = 0

    for doc in dwp_collection.find():
        account_id = doc.get('account_id')
        student_name = doc.get('student_name')
        session_date = doc.get('date')
        if not account_id or not student_name or not str(student_name).strip() or not session_date:
            skipped += 1
            continue

        student_name = str(student_name).strip()
        student_key = make_student_key(account_id, student_name)
        day_key = (student_key, session_date)

        if day_key not in days:
            days[day_key] = {
                'student_key':       student_key,
                'account_id':        account_id,
                'student_name':      student_name,
                'date':              session_date,
                'sessions':          0,
                'sessions_timed':    0,
                'centers':           [],
                'instructors':       [],
                'delivery_methods':  [],
                'pages_completed':   0,
                'minutes_present':   0,
                '_starts':           [],
                '_ends':             [],
                'dwp_report_ids':    [],
            }

        day = days[day_key]
        day['sessions'] += 1
        day['pages_completed'] += doc.get('pages_completed') or 0
        day['dwp_report_ids'].append(doc['_id'])

        # Ordered de-dupe: a two-session day is usually the same center and instructor
        # twice, and the first value seen is the one worth leading with.
        for center in doc.get('centers', []):
            if center and center not in day['centers']:
                day['centers'].append(center)
        for name in doc.get('instructors', []):
            name = (name or '').strip()
            if name and name not in day['instructors']:
                day['instructors'].append(name)
        method = doc.get('delivery_method')
        if method and method not in day['delivery_methods']:
            day['delivery_methods'].append(method)

        start = session_time(session_date, doc.get('session_start'))
        end = session_time(session_date, doc.get('session_end'))
        minutes = session_minutes(start, end)
        if minutes is None:
            untimed_sessions += 1
        else:
            day['sessions_timed'] += 1
            day['minutes_present'] += minutes
        if start:
            day['_starts'].append(start)
        if end:
            day['_ends'].append(end)

    print(f"Found {len(days)} student-days. Building collection...")
    if skipped:
        print(f"  ({skipped} dwp_reports skipped -- missing account_id, student_name or date)")

    attendance_collection.drop()

    documents = []
    for day in days.values():
        starts, ends = day.pop('_starts'), day.pop('_ends')
        # Stored as datetimes, not the source's clock strings, so callers can sort and
        # range-query them without reparsing.
        day['first_session_start'] = min(starts) if starts else None
        day['last_session_end'] = max(ends) if ends else None
        # A day with no trustworthy session times has no measured presence. 0 would read
        # as "attended, stayed no time", which is a different claim.
        if day['sessions_timed'] == 0:
            day['minutes_present'] = None
        day['last_modified'] = datetime.now(timezone.utc)
        documents.append(day)

    if documents:
        # Indexes first, so a bad build fails before the write rather than after.
        # The compound key is what enforces one document per student per day.
        attendance_collection.create_index(
            [('student_key', ASCENDING), ('date', ASCENDING)], unique=True
        )
        attendance_collection.create_index([('date', ASCENDING)])
        attendance_collection.create_index([('account_id', ASCENDING)])
        attendance_collection.create_index([('student_key', ASCENDING)])
        attendance_collection.insert_many(documents)

    multi = sum(1 for d in documents if d['sessions'] > 1)
    at_home = sum(1 for d in documents if '@Home' in d['delivery_methods'])
    print(f"Done. {len(documents)} student-days inserted into '{TARGET_COLLECTION}'.")
    print(f"  sessions:           {sum(d['sessions'] for d in documents)} "
          f"(of {total_dwp} dwp_reports)")
    print(f"  multi-session days: {multi}")
    print(f"  @Home days:         {at_home}")
    print(f"  pages_completed:    {sum(d['pages_completed'] for d in documents)}")
    print(f"  untimed sessions:   {untimed_sessions} (excluded from minutes_present)")
    client.close()


if __name__ == '__main__':
    build_attendance()
