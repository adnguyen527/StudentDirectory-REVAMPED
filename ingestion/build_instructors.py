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

No document here stores a count of its own arrays. The list shows a Students and a Days
column and does not ship days_taught or students to do it -- models/instructor.py derives
both with $size at query time, so the number crosses the wire without the array. Storing
them was 942 KB of arrays or two fields that could drift; deriving them is neither.

topics[] ranks what each instructor taught most, for the instructor profile page. It holds
the same (instructor, topic) counts as topics.instructors[], read from the other side --
the same way students[] here mirrors students.instructors[]. Both sides credit each
instructor on a co-taught session the whole entry, so the two agree pair for pair; a
reconciliation in tests/test_live_database.py holds them to that.

The display name comes from build_topics.canonical_name, not from whichever row was read
first, so a topic the source spells two ways reads identically on both pages. That does
couple the two builds: rebuild topics without rebuilding instructors and a renamed topic
shows its old name here until this runs again.

unfinalized_sessions counts sessions taught whose report was never completed -- no page
count recorded. It is here and nowhere else: a student has no say in whether their
instructor closed out the paperwork, so the number is only meaningful against the person
responsible for it. 1,068 of 29,382 sessions are unfinalized, and they cluster hard by
instructor rather than by date or center.

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
from ingestion.build_students import STATUS_COUNTS
from ingestion.build_topics import canonical_name


TARGET_COLLECTION = 'instructors'


def build_instructors():
    client = MongoClient(uri)
    db = client[db_name]
    dwp_collection = db['dwp_reports']
    instructors_collection = db[TARGET_COLLECTION]

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports into '{TARGET_COLLECTION}'...")

    instructors = {}
    # topic_id -> name -> {sessions, last}, so the display name here is settled by the
    # same rule build_topics uses. Two pages naming one topic differently would be worse
    # than either name being wrong.
    topic_names = {}
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

        # Topics on this session, filtered to the ladder so the counts here mean the same
        # thing as the ones in topics/students. Collected once, credited to each
        # instructor below.
        taught_topics = []
        for topic in doc.get('topics') or []:
            if topic.get('status') not in STATUS_COUNTS:
                continue
            topic_id = topic.get('id') or topic.get('raw', '')
            taught_topics.append(topic_id)
            seen = topic_names.setdefault(topic_id, {}).setdefault(
                topic.get('name'), {'sessions': 0, 'last': None}
            )
            seen['sessions'] += 1
            if date and (seen['last'] is None or date > seen['last']):
                seen['last'] = date

        for name in names:
            if name not in instructors:
                instructors[name] = {
                    'instructor_name':       name,
                    'total_sessions_taught': 0,
                    'co_taught_sessions':    0,
                    'unfinalized_sessions':  0,
                    'total_pages_completed': 0,
                    'days_taught':           set(),
                    'students':              {},   # student_key -> roster entry
                    'topics':                {},   # topic_id -> topic entries taught
                    'centers':               {},   # center name -> session count
                }

            inst = instructors[name]
            inst['total_sessions_taught'] += 1
            inst['total_pages_completed'] += pages
            if co_taught:
                inst['co_taught_sessions'] += 1
            if not doc.get('finalized'):
                inst['unfinalized_sessions'] += 1

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

            # Per-topic tracking. A co-taught session credits each instructor the whole
            # entry, the same rule as pages above and as topics.instructors[] -- the two
            # are the same (instructor, topic) counts read from opposite sides.
            for topic_id in taught_topics:
                inst['topics'][topic_id] = inst['topics'].get(topic_id, 0) + 1

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
        # Most taught first, then by name so the ranking is stable between builds. The
        # name comes from build_topics.canonical_name, so a topic the source spells two
        # ways reads the same here as it does on the topics page.
        topics_list = [
            {
                'topic_id': topic_id,
                'name':     canonical_name(topic_names.get(topic_id, {}))[0] or topic_id,
                'sessions': sessions,
            }
            for topic_id, sessions in inst['topics'].items()
        ]
        topics_list.sort(key=lambda t: (-t['sessions'], t['name']))
        days = sorted(inst['days_taught'])
        documents.append({
            'instructor_name':       inst['instructor_name'],
            'total_sessions_taught': inst['total_sessions_taught'],
            'co_taught_sessions':    inst['co_taught_sessions'],
            'unfinalized_sessions':  inst['unfinalized_sessions'],
            'total_pages_completed': inst['total_pages_completed'],
            'days_taught':           days,
            'last_session_date':     days[-1] if days else None,
            'students':              students_list,
            'topics':                topics_list,
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
    print(f"  roster entries: {sum(len(d['students']) for d in documents)}")
    print(f"  (instructor, topic) pairs: {sum(len(d['topics']) for d in documents)} "
          f"(same pairs as topics.instructors[], from the other side)")
    widest = max(documents, key=lambda d: len(d['topics']))
    print(f"    widest: {widest['instructor_name']} taught "
          f"{len(widest['topics'])} distinct topics")
    unfinalized = sum(d['unfinalized_sessions'] for d in documents)
    worst = sorted(documents, key=lambda d: -d['unfinalized_sessions'])[:3]
    print(f"  unfinalized sessions: {unfinalized}")
    for d in worst:
        if d['unfinalized_sessions']:
            share = d['unfinalized_sessions'] / d['total_sessions_taught']
            print(f"    {d['instructor_name']}: {d['unfinalized_sessions']}"
                  f"/{d['total_sessions_taught']} ({share:.0%})")
    client.close()


if __name__ == '__main__':
    build_instructors()
