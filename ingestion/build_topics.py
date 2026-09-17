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
from statistics import mean, median

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING, DESCENDING
from mongo_url import uri, db_name
from util import make_student_key
from ingestion.build_students import STATUS_COUNTS, build_topic_history


TARGET_COLLECTION = 'topics'


# Below this many finalized sessions a page ratio is noise rather than a pace. 283 of the
# 771 topics clear it, and they are the ones the program median is taken over.
SESSION_PAGES_MIN = 50


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

    Returns (days_by_student, names, instructors, sessions, skipped), where
    days_by_student is {student_key: {date: [(topic_id, name, status), ...]}} -- the shape
    build_topic_history expects -- and sessions is [(student_key, pages, {topic_ids})] for
    page_ratios below.

    The page comparison is described in the README as needing a second pass over
    dwp_reports. It needs a second pass over the *data*, since every student's baseline
    has to be complete before any ratio can be taken, but not a second read: this loop is
    already touching every document, so it collects the sessions on the way past.
    """
    # Buffered per student for the same reason it is buffered in build_students: an
    # assignment boundary is decided by the topics worked on the days in between.
    days_by_student = {}
    names = {}        # topic_id -> name -> {sessions, last}
    instructors = {}  # topic_id -> instructor name -> sessions taught
    sessions = []     # (student_key, pages, {topic_ids}) for the page comparison
    skipped = 0

    for doc in dwp_collection.find(
        {}, {'account_id': 1, 'student_name': 1, 'date': 1, 'topics': 1,
             'instructors': 1, 'pages_completed': 1, 'finalized': 1}
    ):
        entries = doc.get('topics') or []

        account_id   = doc.get('account_id')
        student_name = doc.get('student_name')
        named = bool(account_id and student_name and str(student_name).strip())
        key = make_student_key(account_id, str(student_name).strip()) if named else None

        # ⚠️ Before the topic check below, on purpose. A student's baseline is their own
        # pace across *everything* they did, so a session that recorded no topics still
        # belongs in the denominator -- 5,455 of the 28,314 finalized sessions with a page
        # count carry none, and dropping them would raise every student's baseline.
        if key and doc.get('finalized') and doc.get('pages_completed') is not None:
            sessions.append((
                key,
                doc['pages_completed'],
                {t.get('id') for t in entries if t.get('id')},
            ))

        if not entries:
            continue

        # Counted only for documents that had topics to roll up, which is what this
        # number has always meant.
        if not named:
            skipped += 1
            continue
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

    return days_by_student, names, instructors, sessions, skipped


def page_ratios(sessions):
    """({topic_id: {'ratio': float|None, 'basis': int}}, program median) from the sessions.

    What a topic does to a session's page count -- read against the student's own pace,
    because page pace varies far more between students than between topics, which is what
    makes the student their own control.

    ⚠️ **A comparison, never an attribution.** The numerator is the *whole session's*
    pages_completed, not the topic's share of them. A session carries 2.17 topics on
    average and only 29.5% carry one, so a per-topic share does not exist to be computed.
    Nobody should later "simplify" this into one.

    ⚠️ **Its neutral point is not 1.0.** A session's pages count once for every topic on
    it, which biases every ratio upward: centered on 1.0, 223 of the 283 qualifying topics
    read as speeding students up. The program median returned here -- 1.21 on the current
    data -- is the line to read them against, and half the topics sit each side of it by
    construction.
    """
    total, count = {}, {}
    for key, pages, _ in sessions:
        total[key] = total.get(key, 0) + pages
        count[key] = count.get(key, 0) + 1

    ratios = {}
    for key, pages, topic_ids in sessions:
        baseline = total[key] / count[key] if count.get(key) else 0
        # A student whose finalized sessions recorded no pages at all has no pace to be
        # compared against, and would divide by zero.
        if baseline <= 0:
            continue
        for topic_id in topic_ids:
            ratios.setdefault(topic_id, []).append(pages / baseline)

    per_topic = {
        topic_id: {
            # Thin topics get a basis but no figure. A ratio off a handful of sessions is
            # noise, and nulling it here rather than in the page keeps one threshold in
            # one place for the frontend to check against.
            'ratio': mean(values) if len(values) >= SESSION_PAGES_MIN else None,
            'basis': len(values),
        }
        for topic_id, values in ratios.items()
    }

    qualifying = [t['ratio'] for t in per_topic.values() if t['ratio'] is not None]
    return per_topic, median(qualifying) if qualifying else None


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
                    '_days_to_finish':        [],
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

                # Elapsed days is a different question from sessions: a topic can take
                # four sessions spread over two months.
                #
                # From first sight rather than from last_assignment_started -- 13 days
                # against 9 program-wide. The shorter figure hides the time a topic spent
                # assigned, dropped and assigned again, and "how long does this take" is
                # asked about the whole of it. Both are in the loop if the other is ever
                # wanted.
                first, last = entry['first_seen'], entry['last_seen']
                if first is not None and last is not None:
                    t['_days_to_finish'].append((last - first).days)

            if entry['first_seen'] is not None:
                if t['first_taught'] is None or entry['first_seen'] < t['first_taught']:
                    t['first_taught'] = entry['first_seen']
            if entry['last_seen'] is not None:
                if t['last_taught'] is None or entry['last_seen'] > t['last_taught']:
                    t['last_taught'] = entry['last_seen']

    return topics


def make_documents(topics, names, instructors, pages=None, pages_median=None):
    """Settle each topic's name, finish the derived fields, and order the collection."""
    pages = pages or {}
    documents = []
    for topic_id, t in topics.items():
        name, alternates = canonical_name(names.get(topic_id, {}))
        to_finish = t.pop('_sessions_to_finish')
        days_to_finish = t.pop('_days_to_finish')
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
            # ⚠️ The median leads on both of these. The mean days to finish is 26.7
            # against a median of 13, with a 393-day tail and 7.7% finishing the same
            # day -- a mean on its own describes almost nobody. The mean sessions is
            # stored because it is worth showing *beside* the median, not instead.
            'mean_sessions_to_finish':   mean(to_finish) if to_finish else None,
            'median_days_to_finish':     median(days_to_finish) if days_to_finish else None,
            # What a session carrying this topic does to its page count, against the
            # student's own pace -- see page_ratios. `basis` is how many finalized
            # sessions it rests on, so the page can say what the figure is worth; the
            # ratio itself is null below SESSION_PAGES_MIN of them.
            'session_pages_ratio':       pages.get(topic_id, {}).get('ratio'),
            'session_pages_ratio_basis': pages.get(topic_id, {}).get('basis', 0),
            # ⚠️ Program-wide, and therefore identical on all 771 documents. Denormalised
            # deliberately: it only moves when this builder runs, the whole collection is
            # rebuilt in one pass anyway, and it keeps the detail page a single request.
            # It is the line a topic's own ratio is read against -- not 1.0.
            'session_pages_ratio_median': pages_median,
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

    days_by_student, names, instructors, sessions, skipped = collect(dwp_collection)

    print(f"Read {len(days_by_student)} students. Rolling up topic histories...")
    if skipped:
        print(f"  ({skipped} dwp_reports skipped -- missing account_id or student_name)")

    pages, pages_median = page_ratios(sessions)
    documents = make_documents(
        roll_up(days_by_student), names, instructors, pages, pages_median
    )

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
    rated = [d for d in documents if d['session_pages_ratio'] is not None]
    print(f"  page pace: {len(rated)} topics with {SESSION_PAGES_MIN}+ finalized sessions, "
          f"program median {pages_median:.2f}x" if pages_median else "  page pace: none")
    if rated:
        by_ratio = sorted(rated, key=lambda d: d['session_pages_ratio'])
        print(f"    slowest {by_ratio[0]['session_pages_ratio']:.2f}x "
              f"{by_ratio[0]['name']}")
        print(f"    fastest {by_ratio[-1]['session_pages_ratio']:.2f}x "
              f"{by_ratio[-1]['name']}")
    finished = [d for d in documents if d['median_days_to_finish'] is not None]
    if finished:
        print(f"  median days to finish, across {len(finished)} topics: "
              f"{median(d['median_days_to_finish'] for d in finished):.0f}")

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
