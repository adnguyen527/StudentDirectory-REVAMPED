"""
Build the topics collection by aggregating dwp_reports by topic id.

Reads dwp_reports directly, the same source every other aggregate is built from, and
rolls the per-topic histories up across students. The per-student history is not
re-derived here: build_students.build_topic_history is called per student, so what an
assignment is -- and therefore times_assigned, state, and the reassignment count -- has
exactly one definition. Change DISPLACED_TOPICS_THRESHOLD there and both aggregates move
together.

Keyed on topic id alone, one document per topic, because the Topics tab lists topics and
a topic that appears twice is not a list. Three ids carry two names each, and the name is
settled by a rule rather than a map:

    PK-3121-00  Reducing Fractions using GCF    39 sessions, 2024-08-09 -> 2024-10-01
                Simplifying Fractions using GCF 493 sessions, 2024-10-05 -> 2025-09-17

That one is a real rename -- the old name stops the week the new one starts. The other two
are not renames at all, which is worth knowing before anyone writes a rename map for them:

    PK-3099-00  Classifying Triangles by Angles and Sides  63, 2024-10-29 -> 2025-08-20
                Identifying Triangles                      62, 2024-10-29 -> 2025-08-05
    PK-3081-00  Identifying Pyramids and Prisms            41, 2024-12-18 -> 2025-09-11
                Properties of 3D Figures                   40, 2024-12-18 -> 2025-06-27

Both names start the same day and run side by side for the topic's whole life, splitting
near 50/50. Two labels in concurrent use, not an old name and a new one.

So the canonical name is the one used most recently, tie-broken by sessions and then
alphabetically. Last-used is chosen because it is the rule that stays correct when the
source renames a topic again; on all three collisions above it happens to agree with
most-sessions, so nothing today depends on the choice. The names not chosen are kept in
also_known_as -- the source still writes them, and a search for the old name should find
the topic.

instructors[] ranks who taught the topic most, for the topic detail page. Two things
about it:

Co-taught sessions credit each instructor the whole entry, the rule build_instructors
already applies to pages -- both of them taught it. 5,216 of 50,900 topic entries have
more than one instructor, so summing instructors[].sessions across a topic comes to more
than that topic's sessions (56,728 against 50,900 program-wide). That is expected. These
are per-instructor figures; do not read them as a breakdown of the topic's sessions.

There is deliberately no page count on these entries. Pages are recorded once per session
and a session covers several topics, so charging the session's pages to each topic on it
would multiply the real number. build_instructors can credit pages in full because its
unit is the session -- here it is not.

Three similarly-named counts sit near each other and answer different questions:

    times_mastered      sessions that ended at Mastered, across everybody
    students_finished   students whose last assignment finished, by `state`
    students_mastered   students in that finished group now sitting at Mastered

The last two nest exactly -- every finished student is at Mastered or Completed, 8,551 and
398 of the 8,949 -- so students_finished - students_mastered is the number who completed a
topic without ever mastering it, and the topic page shows the pair as a fraction.

Counts are per (student, topic) pair, not per session: students_finished is how many
students finished the topic, and a student who worked it across nine sessions counts once.
`state` reads a student's last assignment only, so the three state counts partition
unique_students exactly. students_ever_finished asks the different question -- ever
completed or mastered, even if the topic was later handed back -- and so can exceed
students_finished.

Safe to re-run -- drops and rebuilds the target collection each time.
"""

import sys
from pathlib import Path
from datetime import datetime, timezone
from statistics import median

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING, DESCENDING
from mongo_url import uri, db_name
from util import make_student_key
from ingestion.build_students import STATUS_COUNTS, build_topic_history


TARGET_COLLECTION = 'topics'


def canonical_name(names):
    """Pick one display name for a topic from every name the source wrote for it.

    `names` is {name: {'sessions': int, 'last': date_or_None}}. Most recently used wins,
    then most sessions, then alphabetical so the result never depends on read order.
    Returns (name, [the others, same ordering]).
    """
    # Alphabetical first, then a stable sort on the ranking fields: the tie-break has to
    # read forwards while the rest reads backwards, which one reverse=True cannot do.
    ranked = sorted(n for n in names if n)
    ranked.sort(
        key=lambda n: (
            names[n]['last'] is not None,
            names[n]['last'] or datetime.min,
            names[n]['sessions'],
        ),
        reverse=True,
    )
    if not ranked:
        return None, []
    return ranked[0], ranked[1:]


def collect(dwp_collection):
    """Read dwp_reports once into the three things the rollup needs.

    Returns (days_by_student, names, instructors, skipped), where days_by_student is
    {student_key: {date: [(topic_id, name, status), ...]}} -- the shape
    build_topic_history expects.
    """
    # Buffered per student for the same reason it is buffered in build_students: an
    # assignment boundary is decided by the topics worked on the days in between.
    days_by_student = {}
    names = {}        # topic_id -> name -> {sessions, last}
    instructors = {}  # topic_id -> instructor name -> sessions taught
    skipped = 0

    for doc in dwp_collection.find(
        {}, {'account_id': 1, 'student_name': 1, 'date': 1, 'topics': 1, 'instructors': 1}
    ):
        entries = doc.get('topics') or []
        if not entries:
            continue

        account_id   = doc.get('account_id')
        student_name = doc.get('student_name')
        if not account_id or not student_name or not str(student_name).strip():
            skipped += 1
            continue

        key = make_student_key(account_id, str(student_name).strip())
        dt  = doc.get('date')
        day = days_by_student.setdefault(key, {}).setdefault(dt, [])

        taught_by = [n.strip() for n in doc.get('instructors', []) if n and n.strip()]

        for topic in entries:
            topic_id = topic.get('id') or topic.get('raw', '')
            status   = topic.get('status')

            day.append((topic_id, topic.get('name'), status))

            # Only the ladder is rolled up, so only the ladder informs the name and the
            # instructor set -- otherwise these would describe entries no count includes.
            if status not in STATUS_COUNTS:
                continue

            seen = names.setdefault(topic_id, {}).setdefault(
                topic.get('name'), {'sessions': 0, 'last': None}
            )
            seen['sessions'] += 1
            if dt and (seen['last'] is None or dt > seen['last']):
                seen['last'] = dt

            # Each instructor on a co-taught session is credited the whole entry, the
            # same way build_instructors credits pages -- both of them taught it.
            if taught_by:
                taught = instructors.setdefault(topic_id, {})
                for instructor in taught_by:
                    taught[instructor] = taught.get(instructor, 0) + 1

    return days_by_student, names, instructors, skipped


def roll_up(days_by_student):
    """Per-topic totals across every student, from each student's own topic history."""
    topics = {}

    for student_days in days_by_student.values():
        for topic_id, entry in build_topic_history(list(student_days.items())).items():
            t = topics.get(topic_id)
            if t is None:
                t = topics[topic_id] = {
                    'topic_id':               topic_id,
                    'sessions':               0,
                    'times_worked_on':        0,
                    'times_completed':        0,
                    'times_mastered':         0,
                    'unique_students':        0,
                    'students_finished':      0,
                    'students_mastered':      0,
                    'students_on_plan':       0,
                    'students_removed':       0,
                    'students_ever_finished': 0,
                    'total_reassignments':    0,
                    'first_taught':           None,
                    'last_taught':            None,
                    '_sessions_to_finish':    [],
                }

            t['sessions']            += entry['sessions']
            t['times_worked_on']     += entry['times_worked_on']
            t['times_completed']     += entry['times_completed']
            t['times_mastered']      += entry['times_mastered']
            t['unique_students']     += 1
            t['total_reassignments'] += entry['times_assigned'] - 1
            t[f"students_{entry['state']}"] += 1

            # Scoped to the finished students rather than counted off the status across
            # everyone. The two agree on the current data -- every student at Mastered or
            # Completed is finished -- but only because build_students settles an
            # assignment's best from the whole day. Reading the status alone would make
            # this field depend on that staying true, and the topic page divides by
            # students_finished, so a numerator sourced differently could exceed it.
            if entry['state'] == 'finished' and entry['status'] == 'Mastered':
                t['students_mastered'] += 1

            if entry['times_completed'] or entry['times_mastered']:
                t['students_ever_finished'] += 1
                t['_sessions_to_finish'].append(entry['sessions'])

            if entry['first_seen'] is not None:
                if t['first_taught'] is None or entry['first_seen'] < t['first_taught']:
                    t['first_taught'] = entry['first_seen']
            if entry['last_seen'] is not None:
                if t['last_taught'] is None or entry['last_seen'] > t['last_taught']:
                    t['last_taught'] = entry['last_seen']

    return topics


def make_documents(topics, names, instructors):
    """Settle each topic's name, finish the derived fields, and order the collection."""
    documents = []
    for topic_id, t in topics.items():
        name, alternates = canonical_name(names.get(topic_id, {}))
        to_finish = t.pop('_sessions_to_finish')
        # Most sessions first, then alphabetical, so the ranking is stable between builds.
        taught_by = sorted(
            instructors.get(topic_id, {}).items(), key=lambda kv: (-kv[1], kv[0])
        )
        documents.append({
            **t,
            'name':                      name or topic_id,
            'also_known_as':             alternates,
            'instructors':               [
                {'name': n, 'sessions': s} for n, s in taught_by
            ],
            # Sessions the finishing students spent on the topic, counting every
            # assignment -- a topic handed back and finished again carries both.
            'median_sessions_to_finish': median(to_finish) if to_finish else None,
            'last_modified':             datetime.now(timezone.utc),
        })

    documents.sort(key=lambda d: (-d['sessions'], d['name'] or '', d['topic_id'] or ''))
    return documents


def build_topics():
    client = MongoClient(uri)
    db = client[db_name]
    dwp_collection = db['dwp_reports']
    topics_collection = db[TARGET_COLLECTION]

    total_dwp = dwp_collection.count_documents({})
    print(f"Reading {total_dwp} dwp_reports into '{TARGET_COLLECTION}'...")

    days_by_student, names, instructors, skipped = collect(dwp_collection)

    print(f"Read {len(days_by_student)} students. Rolling up topic histories...")
    if skipped:
        print(f"  ({skipped} dwp_reports skipped -- missing account_id or student_name)")

    documents = make_documents(roll_up(days_by_student), names, instructors)

    print(f"Found {len(documents)} topics. Building collection...")

    topics_collection.drop()

    if documents:
        # Indexes first, so a bad build fails before the write rather than after.
        topics_collection.create_index([('topic_id', ASCENDING)], unique=True)
        # The paged sort in models/topic.py -- most worked first. Compound rather than
        # sessions alone because session counts tie constantly (670 of 771 topics share
        # theirs), and skip/limit over a partial order repeats and drops rows. A plain
        # sessions index would be a redundant prefix of this one.
        topics_collection.create_index([('sessions', DESCENDING), ('topic_id', ASCENDING)])
        # Name order is not the default any more, but it is still a total order over the
        # same rows and the column-sort work under TODO -> API will ask for it. Kept
        # because 90 names are carried by more than one topic, so a name sort needs the
        # id in the key or it cannot page safely either.
        topics_collection.create_index([('name', ASCENDING), ('topic_id', ASCENDING)])
        topics_collection.insert_many(documents)

    print(f"Done. {len(documents)} topics inserted into '{TARGET_COLLECTION}'.")
    print(f"  topic entries rolled up: {sum(d['sessions'] for d in documents)} "
          f"(matches the sessions in students.topics[])")
    print(f"  (student, topic) pairs: {sum(d['unique_students'] for d in documents)}")
    print(f"  reassignments: {sum(d['total_reassignments'] for d in documents)}")
    renamed = [d for d in documents if d['also_known_as']]
    print(f"  topics carrying more than one name: {len(renamed)}")
    for d in renamed:
        print(f"    {d['topic_id']}: '{d['name']}' also {d['also_known_as']}")
    credited = sum(i['sessions'] for d in documents for i in d['instructors'])
    print(f"  instructor roster entries: {sum(len(d['instructors']) for d in documents)}")
    print(f"  sessions credited to instructors: {credited} "
          f"(exceeds the {sum(d['sessions'] for d in documents)} entries -- co-taught "
          f"sessions credit each instructor in full)")
    print("  most worked:")
    for d in documents[:3]:
        top = d['instructors'][0] if d['instructors'] else None
        print(f"    {d['name']}: {d['sessions']} entries, "
              f"{d['unique_students']} students, {d['students_finished']} finished"
              + (f", most taught by {top['name']} ({top['sessions']})" if top else ""))
    client.close()


if __name__ == '__main__':
    build_topics()
