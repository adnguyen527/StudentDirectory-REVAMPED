"""
Build the instructors collection by aggregating dwp_reports by instructor name.
Safe to re-run — drops and rebuilds the collection each time.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING
from mongo_url import uri


def build_instructors():
    client = MongoClient(uri)
    db = client['StudentDirectory']
    dwp_collection = db['dwp_reports']
    instructors_collection = db['instructors']

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports...")

    instructors = {}

    for doc in dwp_collection.find():
        names = doc.get('instructors', [])
        if not names:
            continue

        pages    = doc.get('pages_completed') or 0
        date     = doc.get('date')
        centers  = doc.get('centers', [])
        acct_id  = doc.get('account_id')
        stu_name = doc.get('student_name')

        for name in names:
            name = name.strip()
            if not name:
                continue

            if name not in instructors:
                instructors[name] = {
                    'instructor_name':      name,
                    'total_dwps_sessions':       0,
                    'total_pages_completed': 0,
                    'days_taught':          set(),
                    'students':             {},   # account_id → {student_name, sessions, pages_completed}
                    'centers':              {},   # center name → session count
                }

            inst = instructors[name]
            inst['total_dwps_sessions']        += 1
            inst['total_pages_completed'] += pages

            if date:
                inst['days_taught'].add(date)

            # Per-student tracking
            if acct_id:
                if acct_id not in inst['students']:
                    inst['students'][acct_id] = {
                        'account_id':    acct_id,
                        'student_name':  stu_name,
                        'sessions':      0,
                        'pages_completed': 0,
                    }
                inst['students'][acct_id]['sessions']        += 1
                inst['students'][acct_id]['pages_completed'] += pages

            # Per-center tracking
            for center in centers:
                if center:
                    inst['centers'][center] = inst['centers'].get(center, 0) + 1

    print(f"Found {len(instructors)} instructors. Building collection...")

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
        documents.append({
            'instructor_name':       inst['instructor_name'],
            'total_dwps_sessions':        inst['total_dwps_sessions'],
            'total_pages_completed': inst['total_pages_completed'],
            'total_days_taught':     len(inst['days_taught']),
            'days_taught':           sorted(inst['days_taught']),
            'students':              students_list,
            'centers':               centers_list,
            'last_modified':         datetime.now(timezone.utc),
        })

    if documents:
        instructors_collection.insert_many(documents)
        instructors_collection.create_index([('instructor_name', ASCENDING)], unique=True)

    print(f"Done. {len(documents)} instructors inserted into 'instructors' collection.")
    client.close()


if __name__ == '__main__':
    build_instructors()
