"""
Build the instructors collection by aggregating dwp_reports by instructor name.

Rosters are keyed by student_key, not account_id. account_id identifies a household,
so keying on it collapsed siblings into a single roster entry under an arbitrary name
and hid 1,567 student relationships.

Co-taught sessions credit each instructor with the full page count, not a share of it:
both instructors did the work with the student. 2,563 of 29,382 sessions have more than
one instructor, so summing total_pages_completed across instructors comes to more than
the pages in dwp_reports (168,720 vs 153,360). That is expected. These are per-instructor
figures -- do not sum them for a center-wide total; aggregate dwp_reports for that.

Known limitation: instructors are identified by name alone, because that is all the
source data carries. Two distinct people sharing a name would merge into one document.

Safe to re-run -- drops and rebuilds the target collection each time.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING
from mongo_url import uri, db_name
from util import make_student_key


TARGET_COLLECTION = 'instructors'


def build_instructors():
    client = MongoClient(uri)
    db = client[db_name]
    dwp_collection = db['dwp_reports']
    instructors_collection = db[TARGET_COLLECTION]

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports into '{TARGET_COLLECTION}'...")

    instructors = {}
    skipped = 0

    for doc in dwp_collection.find():
        names = [n.strip() for n in doc.get('instructors', []) if n and n.strip()]
        if not names:
            skipped += 1
            continue

        pages    = doc.get('pages_completed') or 0
        date     = doc.get('date')
        centers  = doc.get('centers', [])
        acct_id  = doc.get('account_id')
        stu_name = doc.get('student_name')
        co_taught = len(names) > 1

        for name in names:
            if name not in instructors:
                instructors[name] = {
                    'instructor_name':       name,
                    'total_sessions_taught': 0,
                    'co_taught_sessions':    0,
                    'total_pages_completed': 0,
                    'days_taught':           set(),
                    'students':              {},   # student_key → roster entry
                    'centers':               {},   # center name → session count
                }

            inst = instructors[name]
            inst['total_sessions_taught'] += 1
            inst['total_pages_completed'] += pages
            if co_taught:
                inst['co_taught_sessions'] += 1

            if date:
                inst['days_taught'].add(date)

            # Per-student tracking, keyed by student not household
            if acct_id and stu_name and str(stu_name).strip():
                student_name = str(stu_name).strip()
                key = make_student_key(acct_id, student_name)
                if key not in inst['students']:
                    inst['students'][key] = {
                        'student_key':     key,
                        'account_id':      acct_id,
                        'student_name':    student_name,
                        'sessions':        0,
                        'pages_completed': 0,
                    }
                inst['students'][key]['sessions']        += 1
                inst['students'][key]['pages_completed'] += pages

            # Per-center tracking
            for center in centers:
                if center:
                    inst['centers'][center] = inst['centers'].get(center, 0) + 1

    print(f"Found {len(instructors)} instructors. Building collection...")
    if skipped:
        print(f"  ({skipped} dwp_reports skipped -- no instructor named)")

    instructors_collection.drop()

    documents = []
    for inst in instructors.values():
        students_list = sorted(
            inst['students'].values(),
            key=lambda s: s['sessions'],
            reverse=True
        )
        centers_list = sorted(
            [{'name': n, 'sessions': c} for n, c in inst['centers'].items()],
            key=lambda c: c['sessions'],
            reverse=True
        )
        days = sorted(inst['days_taught'])
        documents.append({
            'instructor_name':       inst['instructor_name'],
            'total_sessions_taught': inst['total_sessions_taught'],
            'co_taught_sessions':    inst['co_taught_sessions'],
            'total_pages_completed': inst['total_pages_completed'],
            'total_days_taught':     len(days),
            'days_taught':           days,
            'last_session_date':     days[-1] if days else None,
            'total_students_taught': len(students_list),
            'students':              students_list,
            'centers':               centers_list,
            'last_modified':         datetime.now(timezone.utc),
        })

    if documents:
        # Indexes first, so a bad build fails before the write rather than after.
        instructors_collection.create_index([('instructor_name', ASCENDING)], unique=True)
        instructors_collection.insert_many(documents)

    print(f"Done. {len(documents)} instructors inserted into '{TARGET_COLLECTION}'.")
    print(f"  sessions taught: {sum(d['total_sessions_taught'] for d in documents)} "
          f"(exceeds {total_dwp} dwp_reports -- co-taught counted once per instructor)")
    print(f"  pages, full credit to each instructor: "
          f"{sum(d['total_pages_completed'] for d in documents)}")
    print(f"  roster entries: {sum(d['total_students_taught'] for d in documents)}")
    client.close()


if __name__ == '__main__':
    build_instructors()
