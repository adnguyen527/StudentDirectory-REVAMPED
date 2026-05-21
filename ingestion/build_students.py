"""
Build the students collection by aggregating dwp_reports by account_id.
Safe to re-run — drops and rebuilds the collection each time.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING
from mongo_url import uri




def build_students():
    client = MongoClient(uri)
    db = client['StudentDirectory']
    dwp_collection = db['dwp_reports']
    students_collection = db['students']

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports...")

    # Accumulate data per student keyed by account_id
    students = {}

    for doc in dwp_collection.find():
        account_id = doc.get('account_id')
        if not account_id:
            continue

        if account_id not in students:
            students[account_id] = {
                'account_id':               account_id,
                'student_name':             doc.get('student_name'),
                'centers':                  {},     # name → session count
                'total_sessions':           0,
                'last_session_date':        None,
                '_last_session_dt':         None,   # for comparison only
                'last_assessment':          None,
                'total_pages_completed':    0,
                'topics_mastered':          {},     # id → {id, name, times_mastered}
                'instructors':              {},     # name → {sessions, pages_completed}
                'dwp_report_ids':           [],
            }

        s = students[account_id]

        # Centers — doc.centers is now a list from import parsing
        for center in doc.get('centers', []):
            if center:
                s['centers'][center] = s['centers'].get(center, 0) + 1

        # Session count + reference
        s['total_sessions'] += 1
        s['dwp_report_ids'].append(doc['_id'])

        # Most recent session — date is now a datetime object
        dt = doc.get('date')
        if dt and (s['_last_session_dt'] is None or dt > s['_last_session_dt']):
            s['_last_session_dt'] = dt
            s['last_session_date'] = dt
            s['last_assessment']   = doc.get('assessment')

        # Pages completed
        s['total_pages_completed'] += doc.get('pages_completed') or 0

        # Instructors
        pages = doc.get('pages_completed') or 0
        for name in doc.get('instructors', []):
            name = name.strip()
            if name:
                if name not in s['instructors']:
                    s['instructors'][name] = {'name': name, 'sessions': 0, 'pages_completed': 0}
                s['instructors'][name]['sessions']        += 1
                s['instructors'][name]['pages_completed'] += pages

        # Topics mastered
        for topic in doc.get('topics', []):
            if topic.get('status') == 'Mastered':
                topic_id = topic.get('id') or topic.get('raw', '')
                if topic_id not in s['topics_mastered']:
                    s['topics_mastered'][topic_id] = {
                        'id':            topic.get('id'),
                        'name':          topic.get('name'),
                        'times_mastered': 0
                    }
                s['topics_mastered'][topic_id]['times_mastered'] += 1

    print(f"Found {len(students)} unique students. Building collection...")

    # Drop and rebuild
    students_collection.drop()

    documents = []
    for s in students.values():
        topics_list = sorted(
            s['topics_mastered'].values(),
            key=lambda t: t['times_mastered'],
            reverse=True
        )
        documents.append({
            'account_id':                s['account_id'],
            'student_name':              s['student_name'],
            'centers':                   sorted(
                [{'name': name, 'sessions': count} for name, count in s['centers'].items()],
                key=lambda c: c['sessions'],
                reverse=True
            ),
            'total_sessions':            s['total_sessions'],
            'last_session_date':         s['last_session_date'],
            'last_assessment':           s['last_assessment'],
            'total_pages_completed':     s['total_pages_completed'],
            'instructors':               sorted(
                s['instructors'].values(),
                key=lambda i: i['sessions'],
                reverse=True
            ),
            'topics_mastered':           topics_list,
            'total_unique_topics_mastered': len(topics_list),
            'dwp_report_ids':            s['dwp_report_ids'],
            'last_modified':             datetime.now(timezone.utc),
        })

    if documents:
        students_collection.insert_many(documents)
        students_collection.create_index([('account_id', ASCENDING)], unique=True)
        students_collection.create_index([('student_name', ASCENDING)])

    print(f"Done. {len(documents)} students inserted into 'students' collection.")
    client.close()


if __name__ == '__main__':
    build_students()
