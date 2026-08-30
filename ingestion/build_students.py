"""
Build the students collection by aggregating dwp_reports by (account_id, student_name).

account_id identifies a household, not a student -- 191 accounts carry 2-5 siblings.
Keying on account_id alone collapses those siblings into a single profile whose name is
whichever row happened to be read first, so students are keyed by account plus name.

Safe to re-run -- drops and rebuilds the target collection each time.
"""

import sys
from collections import Counter
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING
from mongo_url import uri, db_name
from util import make_student_key


TARGET_COLLECTION = 'students'

# Topic status is a ladder: Worked On (worked, not completed) -> Completed (completed, not
# mastered) -> Mastered (completed and mastered). Ranked so that a move down the ladder can
# be recognised -- that is a topic being handed back to the student.
STATUS_RANK = {'Worked On': 1, 'Completed': 2, 'Mastered': 3}

STATUS_COUNTS = {
    'Worked On': 'times_worked_on',
    'Completed': 'times_completed',
    'Mastered':  'times_mastered',
}

# A topic is never simply idle in a lesson plan. If the student is working other topics
# instead, this one was taken off the plan; when it comes back it is a fresh assignment,
# recommended by a new assessment or a new plan. So an assignment boundary is measured in
# topics that displaced it, not in days or sessions elapsed -- students work at very
# different paces, and displacement is what actually says the plan moved on.
#
# Six is deliberately conservative. Of the 37,121 times a topic was returned to, 97.1% had
# five or fewer other topics in between, so only the clearest 2.9% read as a new
# assignment: the rule would rather join two real assignments than split one in half.
DISPLACED_TOPICS_THRESHOLD = 6


def _new_entry(topic_id, name, status, date):
    return {
        'id':                      topic_id,
        'name':                    name,
        'sessions':                0,
        'times_worked_on':         0,
        'times_completed':         0,
        'times_mastered':          0,
        'times_assigned':          1,
        'first_seen':              date,
        'last_seen':               date,
        'last_assignment_started': date,
        'status':                  status,
        # Working state, dropped before the entry is stored.
        '_last_day':               None,
        '_assignment_best':        STATUS_RANK[status],
    }


def build_topic_history(days):
    """Per-topic history for one student, from every day they attended.

    `days` is [(date, [(topic_id, name, status), ...]), ...] -- one tuple per date, holding
    every topic entry recorded that day across however many sessions it held. Order does
    not matter; the days are sorted here, because the whole notion of an assignment is a
    sequence and reading it out of order would be meaningless.

    A day is the unit for deciding assignments, but each entry still counts towards
    `sessions`, so a topic covered twice in one day counts twice -- 70 student-days in the
    current data carry more than one session.

    Returns {topic_id: entry}. Topics are identified by id, falling back to the raw text
    when the source gave none, and statuses outside the ladder are ignored.
    """
    days = sorted(days, key=lambda d: (d[0] is None, d[0]))
    topics = {}
    seen_per_day = []

    for index, (date, entries) in enumerate(days):
        best_today = {}

        for topic_id, name, status in entries:
            if status not in STATUS_COUNTS:
                continue

            entry = topics.get(topic_id)
            if entry is None:
                entry = topics[topic_id] = _new_entry(topic_id, name, status, date)
            elif not entry['name'] and name:
                entry['name'] = name

            entry['sessions'] += 1
            entry[STATUS_COUNTS[status]] += 1

            # One day, one standing: if a topic was worked twice, the better result is
            # what the day reached.
            if STATUS_RANK[status] > STATUS_RANK.get(best_today.get(topic_id), 0):
                best_today[topic_id] = status

        seen_per_day.append(set(best_today))

        for topic_id, status in best_today.items():
            entry = topics[topic_id]

            if entry['_last_day'] is not None:
                displaced = _displaced_between(seen_per_day, entry['_last_day'], index)
                displaced.discard(topic_id)
                regressed = STATUS_RANK[status] < STATUS_RANK[entry['status']]

                if len(displaced) >= DISPLACED_TOPICS_THRESHOLD or regressed:
                    entry['times_assigned'] += 1
                    entry['last_assignment_started'] = date
                    entry['_assignment_best'] = STATUS_RANK[status]
                else:
                    entry['_assignment_best'] = max(
                        entry['_assignment_best'], STATUS_RANK[status]
                    )
                if date is not None:
                    entry['last_seen'] = date

            entry['status'] = status
            entry['_last_day'] = index

    _finalize(topics, seen_per_day)
    return topics


def _displaced_between(seen_per_day, start, end):
    """Distinct topics worked between two days, both excluded."""
    displaced = set()
    for i in range(start + 1, end):
        displaced |= seen_per_day[i]
    return displaced


def _finalize(topics, seen_per_day):
    """Settle each topic's state and drop the working fields.

    `state` reads the *last* assignment only -- a topic finished long ago and assigned
    again is not finished now. That is why it is not the same question as
    total_unique_topics_finished, which asks whether a topic was ever finished at all.
    """
    # Suffix unions, so the trailing displacement is one lookup per topic rather than a
    # walk to the end of the student's history for each of them.
    suffix = [set() for _ in range(len(seen_per_day) + 1)]
    for i in range(len(seen_per_day) - 1, -1, -1):
        suffix[i] = suffix[i + 1] | seen_per_day[i]

    for topic_id, entry in topics.items():
        if entry['_assignment_best'] > STATUS_RANK['Worked On']:
            entry['state'] = 'finished'
        else:
            displaced = suffix[entry['_last_day'] + 1] - {topic_id}
            entry['state'] = (
                'removed' if len(displaced) >= DISPLACED_TOPICS_THRESHOLD else 'on_plan'
            )

        del entry['_last_day']
        del entry['_assignment_best']


def topic_list(topics_by_id):
    """Per-topic history, most worked through first, then alphabetical for stability."""
    return sorted(
        topics_by_id.values(),
        key=lambda t: (-t['sessions'], t['name'] or '', t['id'] or ''),
    )


def count_topics(topics, *count_fields):
    """How many distinct topics ever reached any of these statuses.

    'Ever', not 'currently': a topic reassigned after mastery keeps its times_mastered.
    Each entry's `status` is what says where the topic stands now.
    """
    return sum(1 for t in topics if any(t[field] for field in count_fields))


def build_students():
    client = MongoClient(uri)
    db = client[db_name]
    dwp_collection = db['dwp_reports']
    students_collection = db[TARGET_COLLECTION]

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports into '{TARGET_COLLECTION}'...")

    # Accumulate data per student keyed by (account_id, student_name)
    students = {}
    skipped = 0

    for doc in dwp_collection.find():
        account_id   = doc.get('account_id')
        student_name = doc.get('student_name')
        if not account_id or not student_name or not str(student_name).strip():
            skipped += 1
            continue

        student_name = str(student_name).strip()
        key = make_student_key(account_id, student_name)

        if key not in students:
            students[key] = {
                'student_key':              key,
                'account_id':               account_id,
                'student_name':             student_name,
                'centers':                  {},     # name -> session count
                'total_sessions':           0,
                'last_session_date':        None,
                '_last_session_dt':         None,   # for comparison only
                'last_assessment':          None,
                'total_pages_completed':    0,
                # date -> the topic entries recorded that day. Buffered rather than folded
                # in as it streams, because deciding where one assignment ends and the next
                # begins needs the topics of the days in between.
                'days':                     {},
                'instructors':              {},     # name -> {sessions, pages_completed}
                'dwp_report_ids':           [],
            }

        s = students[key]

        # Centers -- doc.centers is now a list from import parsing
        for center in doc.get('centers', []):
            if center:
                s['centers'][center] = s['centers'].get(center, 0) + 1

        # Session count + reference
        s['total_sessions'] += 1
        s['dwp_report_ids'].append(doc['_id'])

        # Most recent session -- date is now a datetime object
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

        # Topics, held by day until the whole student has been read
        day = s['days'].setdefault(dt, [])
        for topic in doc.get('topics') or []:
            day.append((
                topic.get('id') or topic.get('raw', ''),
                topic.get('name'),
                topic.get('status'),
            ))

    print(f"Found {len(students)} unique students. Building collection...")
    if skipped:
        print(f"  ({skipped} dwp_reports skipped -- missing account_id or student_name)")

    # Drop and rebuild
    students_collection.drop()

    documents = []
    for s in students.values():
        topics = topic_list(build_topic_history(list(s['days'].items())))
        states = Counter(t['state'] for t in topics)
        documents.append({
            'student_key':               s['student_key'],
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
            'topics':                    topics,
            'total_unique_topics_mastered':  count_topics(topics, 'times_mastered'),
            'total_unique_topics_completed': count_topics(topics, 'times_completed'),
            # What a parent means by "finished": Mastered implies completed, and the
            # source writes one status per session rather than both, so a topic mastered
            # but never marked Completed -- 8,739 of them -- is missing from the count
            # above. This is the figure to show; that one is the rare completed-but-not-
            # mastered remainder.
            'total_unique_topics_finished':
                count_topics(topics, 'times_completed', 'times_mastered'),
            # Times a topic was assigned again after being taken off the plan. Not the
            # same as a status regression, which is only the subset that had already been
            # finished once -- 885 of the 1,235.
            'total_topic_reassignments': sum(t['times_assigned'] - 1 for t in topics),
            # For the profile page's "what is still open": filtering 100-entry arrays per
            # student in the client is what these exist to avoid.
            'total_topics_on_plan':      states['on_plan'],
            'total_topics_removed':      states['removed'],
            'dwp_report_ids':            s['dwp_report_ids'],
            'last_modified':             datetime.now(timezone.utc),
        })

    if documents:
        # Indexes first, so a key-derivation bug fails before the write rather than after.
        # account_id is deliberately NOT unique -- siblings share one.
        students_collection.create_index([('student_key', ASCENDING)], unique=True)
        students_collection.create_index([('account_id', ASCENDING)])
        # Compound, and in this order, because it is the sort /api/students pages by --
        # see models/student.py. student_name alone leaves the paged query a collection
        # scan with a blocking sort, and cannot break the ties: 17 students share a name
        # with someone, and an unstable tie can repeat or skip one across a page boundary.
        students_collection.create_index(
            [('student_name', ASCENDING), ('student_key', ASCENDING)]
        )
        students_collection.insert_many(documents)

    print(f"Done. {len(documents)} students inserted into '{TARGET_COLLECTION}'.")
    print(f"  total_sessions:        {sum(d['total_sessions'] for d in documents)}")
    print(f"  total_pages_completed: {sum(d['total_pages_completed'] for d in documents)}")
    entries = sum(len(d['topics']) for d in documents)
    assignments = sum(t['times_assigned'] for d in documents for t in d['topics'])
    repeated = sum(1 for d in documents for t in d['topics'] if t['times_assigned'] > 1)
    finished = sum(d['total_unique_topics_finished'] for d in documents)
    print(f"  topic entries:         {entries}")
    print(f"  topic assignments:     {assignments}")
    print(f"  topics assigned more than once: {repeated}")
    print(f"  topics finished (completed or mastered): {finished}")
    print(f"  topics still on plan:  {sum(d['total_topics_on_plan'] for d in documents)}")
    print(f"  topics removed:        {sum(d['total_topics_removed'] for d in documents)}")
    client.close()


if __name__ == '__main__':
    build_students()
