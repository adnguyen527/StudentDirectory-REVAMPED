"""
Import anonymized data from Excel files into MongoDB.

DWP rows are parsed at import time -- compound string fields are split into
discrete typed fields before insertion.

Writes are keyed on a natural key -- (account_id, student_name, date, session_start)
for dwp_reports, and row_hash for the collections that have nothing stable to key on.
row_hash is now only change detection: a row whose hash matches what is stored is
skipped, and a row whose hash differs REPLACES its document in place, keeping its _id.

So re-importing an unchanged file is a no-op, and re-importing a file in which a row was
corrected at the source updates that row rather than landing a second copy beside it.

The natural key is not unique in the current data -- four student-days carry two rows
each. A key matching more than one stored document is reported and skipped rather than
half-updated; see _upsert.

Run ingestion/migrations/backfill_row_hash.py once before the first import, to hash documents
loaded before this mechanism existed.
"""

import hashlib
import re
from collections import defaultdict
from pathlib import Path
from datetime import datetime, time
from bson import json_util
from pymongo import MongoClient, ReplaceOne, ASCENDING, DESCENDING
from pymongo.errors import BulkWriteError
from mongo_url import uri, db_name
import openpyxl


# ── DWP parsing helpers ───────────────────────────────────────────────────────

def _split(value):
    """'Key: Value;  Key: Value' -> dict"""
    if not value:
        return {}
    result = {}
    for part in str(value).split(';  '):
        part = part.strip()
        if ': ' in part:
            key, val = part.split(': ', 1)
            result[key.strip()] = val.strip()
    return result

def _int(value):
    if value is None or str(value).strip() == 'None':
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

def _bool(value):
    if value is None:
        return None
    return str(value).strip().lower() == 'yes'

def _none(value):
    return None if (value is None or str(value).strip() == 'None') else value

def _to_snake(s):
    return re.sub(r'[^a-z0-9]+', '_', str(s).lower()).strip('_')

def _parse_date(value):
    """'07/30/2025' -> a naive datetime at midnight.

    Naive on purpose, and stored that way -- see combine_session_time below for what that
    means downstream.
    """
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), '%m/%d/%Y')
    except ValueError:
        return None


def _parse_clock(value):
    """'3:58 PM' -> datetime.time, or None if the cell holds nothing usable."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == 'None':
        return None
    try:
        return datetime.strptime(text.upper(), '%I:%M %p').time()
    except ValueError:
        return None


def combine_session_time(session_date, value):
    """The session date plus a clock reading -> one datetime.

    A time with no date attached cannot be sorted, ranged or subtracted without knowing
    which day it belongs to, so the two halves are joined once here rather than rejoined
    by every consumer. Returns None if either half is missing: a time on no date is not
    a moment.

    THE RESULT IS NAIVE, AND MONGO STORES NAIVE AS UTC. The source gives a wall clock and
    no zone -- "3:58 PM" at the center -- and datetime.combine keeps it that way, so what
    lands in the database reads as 15:58 UTC while meaning 3:58 PM local. Every session in
    the collection carries that same offset-free wall clock, so they sort, range and
    subtract against each other correctly, which is all this system does with them.

    What it means is that these are NOT instants, and converting one to a local zone
    corrupts it: in US Central a 5:53 PM session re-reads as 12:53 PM, and a `date` at
    midnight lands on the day before. Read and render them in UTC to get the value the
    center actually wrote down. The frontend formats every date and time with
    timeZone: 'UTC' for this reason -- see frontend/src/api/bson.ts.

    Attaching a real zone would mean knowing each center's, handling the DST boundaries
    across the 2024-2025 range, and backfilling 29,382 rows -- worth doing only if this
    ever has to line up against something outside the dataset.
    """
    if isinstance(value, datetime):
        return value
    clock = _parse_clock(value)
    if clock is None or session_date is None:
        return None
    return datetime.combine(session_date.date(), clock)


def _parse_finalized_date(value):
    """' 01/02/2025 \\n 3:59 PM' -> datetime(2025, 1, 2, 15, 59)

    The source packs the date and the time of finalization into one cell, separated by a
    newline and padded with spaces. Stored raw, it is a string nobody can range-query --
    'when was this report actually closed out' needs a real datetime.

    Whitespace is collapsed rather than split on '\\n' specifically, so a cell that uses
    a different separator still parses. A date with no time is accepted as midnight.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = ' '.join(str(value).split())
    if not text or text == 'None':
        return None
    for fmt in ('%m/%d/%Y %I:%M %p', '%m/%d/%Y'):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


# ONE TIME BACKFILL
# Anonymization artifacts. The name mapping assigned a person's name to rows whose
# instructor was empty in the source, so an unattributed session became one belonging to
# someone who does not exist -- 73 rows, and no row anywhere with an empty instructors
# list, which silently disabled the "no instructor named" guard in build_instructors.py.
# Names here are dropped at parse time so the emptiness survives into the database.
PLACEHOLDER_INSTRUCTORS = {'Elizabeth Griffin'}


def parse_instructors(value):
    """'Dana Reyes, Sam Ortiz' -> ['Dana Reyes', 'Sam Ortiz'], placeholders removed.

    A row left with no instructors is unattributed, which is a fact about the row and
    not a reason to drop it: the session still happened and still counts for the student.
    """
    if not value:
        return []
    names = [name.strip() for name in str(value).split(',')]
    return [n for n in names if n and n not in PLACEHOLDER_INSTRUCTORS]


def parse_session(value):
    p = _split(value)
    instructors_str = p.get('Instructors', '')
    return {
        'sessions_this_month': _int(p.get('Sessions This Month')),
        # _none(), like every other optional field here: the source writes the literal
        # string 'None' for a session with no recorded time, and it has to land as a
        # null. Without this, 'None' is stored as a value and every consumer has to know
        # to special-case it.
        'session_start':       _none(p.get('Session Start')),
        'session_end':         _none(p.get('Session End')),
        'instructors':         parse_instructors(instructors_str),
    }

def parse_general_information(value):
    p = _split(value)
    return {
        'session_page_goal': _int(p.get('Session Page Goal')),
        'pages_completed':   _int(p.get('Pages Completed')),
        'mathlete_score':    _int(p.get('Mathlete Score')),
        'last_punch_of_day': _bool(p.get('Last Punch of the Day'))
    }

def parse_digital_reward_system(value):
    p = _split(value)
    stars_str = p.get('Stars on current card', '0')
    if '/' in stars_str:
        left, right = stars_str.split('/', 1)
        stars_current, stars_max = _int(left.strip()), _int(right.strip())
    else:
        stars_current, stars_max = _int(stars_str), None

    session_stars_str = p.get('Session', '0 stars added')
    return {
        'card_level':          _none(p.get('Card level')),
        'stars_current':       stars_current,
        'stars_max':           stars_max,
        'session_stars_added': _int(session_stars_str.split(' ')[0])
    }

def parse_student_materials(value):
    p = _split(value)
    result = {
        'primary_deck_next_page':      _none(p.get('Start page for next session - Primary Deck')),
        'needs_primary_deck_update':   _bool(p.get('Needs Primary Deck update')),
        'secondary_deck_next_page':    _none(p.get('Start page for next session - Secondary Deck')),
        'needs_secondary_deck_update': _bool(p.get('Needs Secondary Deck update')),
        'internet_rating':             _none(p.get('Internet Rating'))
    }
    if 'Problem of the Week' in p:
        result['problem_of_the_week'] = _bool(p['Problem of the Week'])
    return result

def parse_schoolwork(value):
    p = _split(value)
    duration_str = p.get('Duration', '0 min')
    return {
        'schoolwork_start_time':  _none(p.get('Start time')),
        'schoolwork_duration_min': _int(duration_str.split(' ')[0]),
        'schoolwork_completed':   _bool(p.get('Completed')),
        'schoolwork_checked':     _bool(p.get('Checked')),
        'schoolwork_description': _none(p.get('Description'))
    }

def parse_lp_assignment(value):
    if not value:
        return []
    topics = []
    for entry in str(value).split(';  '):
        entry = entry.strip()
        if not entry:
            continue
        match = re.match(r'^([\w-]+)\s+\((.+)\):\s+(.+)$', entry)
        if match:
            topics.append({'id': match.group(1), 'name': match.group(2), 'status': match.group(3).strip()})
        else:
            topics.append({'raw': entry})
    return topics


COMPOUND_FIELDS = ['Session', 'General Information', 'Digital Reward System', 'Student Materials', 'LP Assignment', 'Schoolwork', 'Center']

def parse_center(value):
    """'Southlake, Mann Mathematics' -> {'centers': ['Southlake'],
                                         'center_orgs': ['Mann Mathematics']}

    The Center cell is '<location>, <organization>'. The organization is the operating
    brand on the date of the session, not a property of the student or the session:
    every location switched from 'Mann Mathematics' to 'Math Made Simple' on 2025-09-05,
    so a student attending either side of that date would otherwise appear to have
    attended two different centers. 1,438 rows carry a bare location and no organization.

    '@Home Classroom 1' (37 rows, Southlake, Aug-Dec 2024) sits in the organization
    position but names a room rather than a brand. It is kept as-is rather than special
    cased -- the position is what this function knows about.
    """
    if not value:
        return {'centers': [], 'center_orgs': []}

    centers, orgs = [], []
    for entry in str(value).split(';  '):
        entry = entry.strip()
        if not entry:
            continue
        # partition, not split: a location containing a comma would otherwise lose
        # everything past the first one.
        location, _, org = entry.partition(', ')
        location = location.strip()
        org = org.strip()
        if location and location not in centers:
            centers.append(location)
        if org and org not in orgs:
            orgs.append(org)
    return {'centers': centers, 'center_orgs': orgs}

def row_hash(doc):
    """Content fingerprint of a document -- what tells a changed row from an unchanged one.

    Not an identity. Two documents hashing differently means the row was edited, not that
    it is a different session; NATURAL_KEY answers identity. The hash is still the only
    key the collections below dwp_reports have, since they are stored as the source
    spells them and carry nothing stable to key on.

    json_util handles BSON types (datetime, ObjectId) deterministically; sort_keys
    makes the digest independent of field insertion order.
    """
    body = {k: v for k, v in doc.items() if k not in ('_id', 'row_hash')}
    return hashlib.sha1(json_util.dumps(body, sort_keys=True).encode()).hexdigest()


# The fields that say which session a dwp row is about, as opposed to what it records
# about that session. Everything else on the document can be corrected at the source
# without the row becoming a different record, which is what makes these the identity.
#
# `finalized` is deliberately NOT among them. A draft that is later completed is the
# commonest edit there is, and keying on the flag would file the completed report as a
# second session rather than as an update to the first -- the exact bug this key exists
# to fix.
#
# The key is NOT unique. Four student-days in the current data carry two rows sharing
# one: three are an abandoned draft beside the real record, and the fourth (2025-07-01)
# is two completed reports for one session by two instructors, differing in their notes,
# assessments and topic statuses. No key built from stable fields separates that last
# pair, so _upsert refuses to guess between them rather than pretending it can.
NATURAL_KEY = ('account_id', 'student_name', 'date', 'session_start')


def _key_fields(collection_name):
    """What identifies a row in this collection.

    Only dwp_reports is parsed into fields with a meaning. The rest are stored as the
    source spells them, so their fingerprint is the only identity available and an edited
    row there still lands as a new document.
    """
    return NATURAL_KEY if collection_name == 'dwp_reports' else ('row_hash',)


def _describe(value):
    """One key component, short enough that a whole key sits on one terminal line."""
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d' if value.time() == time.min else '%H:%M')
    return str(value)


def _is_row_hash_conflict(write_error):
    """True if a duplicate-key error came from the row_hash index rather than another.

    Only a race reaches this now: another writer storing the same row between _upsert's
    read and its write. keyPattern is present on modern servers; the message is the
    fallback.
    """
    key_pattern = write_error.get('keyPattern')
    if key_pattern is not None:
        return 'row_hash' in key_pattern
    return 'row_hash' in write_error.get('errmsg', '')


def transform_dwp_row(row):
    doc = {_to_snake(k): v for k, v in row.items() if k not in COMPOUND_FIELDS}
    doc['date'] = _parse_date(row.get('Date'))
    # Read back off the snake-cased doc rather than the raw row, so this does not depend
    # on the source's column heading staying spelled the way it is today.
    doc['finalized_date'] = _parse_finalized_date(doc.get('finalized_date'))
    doc.update(parse_session(row.get('Session')))
    # parse_session sees only the Session cell, so it cannot know the date. Join the two
    # halves here, where both are in hand.
    doc['session_start'] = combine_session_time(doc['date'], doc.get('session_start'))
    doc['session_end'] = combine_session_time(doc['date'], doc.get('session_end'))
    doc.update(parse_general_information(row.get('General Information')))
    doc.update(parse_digital_reward_system(row.get('Digital Reward System')))
    doc.update(parse_student_materials(row.get('Student Materials')))
    doc.update(parse_schoolwork(row.get('Schoolwork')))
    doc.update(parse_center(row.get('Center')))
    doc['topics'] = parse_lp_assignment(row.get('LP Assignment'))
    doc['finalized'] = is_finalized(doc)
    doc['row_hash'] = row_hash(doc)
    return doc


def is_finalized(doc):
    """Was this session's report actually completed?

    Keyed on pages_completed, not finalized_date. 1,068 rows have no page count; 996 of
    them also have no finalized_date, but 547 other rows carry a finalized_date with a
    real page count missing from neither -- and 72 rows (all December 2024) are the
    reverse, finalized with no pages. A page count is the signal that survives both.

    An unfinalized row is still a session that happened: 968 of the 996 are the only
    record of that student-day, and all 996 name an instructor. They belong in
    attendance and out of any pages-per-session rate, which is what this flag is for.
    """
    return doc.get('pages_completed') is not None


# ── Importer ──────────────────────────────────────────────────────────────────

class DataImporter:

    def __init__(self):
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        self.stats = {
            'dwp_reports': 0,
            'attendance_reports': 0,
            'enrollment_reports': 0,
            'student_reports': 0,
            'birthday_reports': 0,
            'total_files': 0,
            'total_documents': 0,
            'unchanged': 0,
            'updated': 0,
            'repeated_in_file': 0,
            'ambiguous': 0,
            'errors': 0
        }
        # Keys _upsert could not resolve, for the file being imported. Held rather than
        # printed as they are found so they land under that file's summary line.
        self.ambiguous_keys = []

    def _read_excel(self, path):
        wb = openpyxl.load_workbook(path)
        ws = wb.active
        headers = [cell.value for cell in ws[1]]
        docs = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if not any(row):
                continue
            docs.append({h: v for h, v in zip(headers, row) if h})
        return docs

    def _collection_name(self, filename):
        name = filename.lower()
        if 'digital workout plan' in name or 'dwp' in name:
            return 'dwp_reports'
        if 'attendance' in name:
            return 'attendance_reports'
        if 'enrollment' in name:
            return 'enrollment_reports'
        if 'birthday' in name:
            return 'birthday_reports'
        if 'student' in name and 'report' in name:
            return 'student_reports'
        return None

    def import_file(self, path):
        filename = Path(path).name
        collection_name = self._collection_name(filename)
        if not collection_name:
            print(f"    [warn] Unknown file type, skipping: {filename}")
            return

        rows = self._read_excel(path)
        if not rows:
            print(f"    [warn] No data: {filename}")
            return

        if collection_name == 'dwp_reports':
            rows = [transform_dwp_row(row) for row in rows]
        else:
            for row in rows:
                row['row_hash'] = row_hash(row)

        try:
            inserted, unchanged, updated, repeated, ambiguous = self._upsert(
                collection_name, rows)
            notes = ''.join([
                f", {repeated} repeated in file" if repeated else "",
                f", {ambiguous} ambiguous" if ambiguous else "",
            ])
            print(f"    [ok] {inserted} new, {unchanged} unchanged, {updated} updated"
                  f"{notes} -> {collection_name}")
            for line in self.ambiguous_keys:
                print(f"      {line}")
            self.stats[collection_name] += inserted
            self.stats['total_documents'] += inserted
            self.stats['unchanged'] += unchanged
            self.stats['updated'] += updated
            self.stats['repeated_in_file'] += repeated
            self.stats['ambiguous'] += ambiguous
        except Exception as e:
            print(f"    [!!] Insert error: {e}")
            self.stats['errors'] += 1

    def _upsert(self, collection_name, docs):
        """Write each row to the document its natural key names, if the row changed.

        A key naming nothing is inserted. A key naming one document is left alone when
        the row_hash matches and REPLACED when it differs -- replaced rather than
        re-inserted, so the _id survives: students.dwp_report_ids[] and
        attendance_reports.dwp_report_ids[] hold those ids, and /api/reports/<id> is the
        only handle the frontend has on a report.

        A key naming more than one document is AMBIGUOUS and skipped whole. Updating one
        of two would leave the other stale and invisible, and there is no rule that picks
        correctly between the 2025-07-01 pair -- see NATURAL_KEY. The same applies
        within one file: rows sharing a key but disagreeing on content are all skipped,
        since nothing here can tell a corrected row from a second genuine one.

        Returns (inserted, unchanged, updated, repeated_within_file, ambiguous), where
        ambiguous counts rows in the file that were not written.
        """
        collection = self.db[collection_name]
        self._ensure_indexes(collection_name)
        fields = _key_fields(collection_name)
        self.ambiguous_keys = []

        by_key = defaultdict(list)
        for doc in docs:
            by_key[tuple(doc.get(field) for field in fields)].append(doc)

        repeated = ambiguous = 0
        candidates = {}
        for key, group in by_key.items():
            if len({d['row_hash'] for d in group}) > 1:
                ambiguous += len(group)
                self._note_ambiguous(fields, key, len(group), 'rows in this file')
                continue
            # Byte-identical rows repeated inside one file: collapse to a single write.
            repeated += len(group) - 1
            candidates[key] = group[0]

        # One read per 1,000 keys, the way the hash lookup it replaces was chunked.
        # Served by the natural_key index -- without it this is a collection scan.
        projection = dict.fromkeys(fields, 1)
        projection['row_hash'] = 1
        stored = defaultdict(list)
        keys = list(candidates)
        for i in range(0, len(keys), 1000):
            chunk = keys[i:i + 1000]
            query = {'$or': [dict(zip(fields, key)) for key in chunk]}
            for found in collection.find(query, projection):
                stored[tuple(found.get(field) for field in fields)].append(found)

        ops, unchanged = [], 0
        for key, doc in candidates.items():
            matches = stored.get(key, [])
            if len(matches) > 1:
                ambiguous += 1
                self._note_ambiguous(fields, key, len(matches), 'stored documents')
            elif matches and matches[0].get('row_hash') == doc['row_hash']:
                unchanged += 1
            else:
                ops.append(ReplaceOne(dict(zip(fields, key)), doc, upsert=True))

        inserted = updated = 0
        if ops:
            try:
                result = collection.bulk_write(ops, ordered=False)
                inserted, updated = result.upserted_count, result.modified_count
            except BulkWriteError as e:
                # A row_hash duplicate here means another writer stored the same row
                # between the read above and this write -- harmless, the row is stored.
                # A duplicate on any other index is a real problem and must not be
                # swallowed, so check which index actually collided.
                unexpected = [w for w in e.details['writeErrors']
                              if w['code'] != 11000 or not _is_row_hash_conflict(w)]
                if unexpected:
                    raise
                inserted, updated = e.details['nUpserted'], e.details['nModified']

        return inserted, unchanged, updated, repeated, ambiguous

    def _note_ambiguous(self, fields, key, count, what):
        """Record a key that could not be resolved, in terms a person can look it up by.

        account_id is dropped from the description: it is a household UUID, and the
        student name beside the date and time is what identifies the session to someone
        reading the source.
        """
        described = ' '.join(_describe(value)
                             for field, value in zip(fields, key)
                             if field != 'account_id')
        self.ambiguous_keys.append(
            f"ambiguous: {described} ({count} {what} share this key)")

    def _ensure_indexes(self, collection_name):
        collection = self.db[collection_name]
        # No longer what enforces idempotency -- the natural key is. Kept, and kept
        # unique, for two reasons: it is still the only key the collections without a
        # natural one have, and on dwp_reports it is a corruption tripwire, since the key
        # fields are part of the hashed body and two documents sharing a hash would have
        # to be one session stored twice.
        collection.create_index([('row_hash', ASCENDING)], unique=True)
        if collection_name == 'dwp_reports':
            collection.create_index([('date', ASCENDING)])
            collection.create_index([('account_id', ASCENDING)])
            # Created here as well as by backfill_finalized.py, which is where it came
            # from -- a fresh import into an empty cluster never runs that migration.
            collection.create_index([('finalized', ASCENDING)])
            # What every import looks its rows up by. Deliberately not unique: four
            # student-days carry two rows each -- see NATURAL_KEY.
            collection.create_index([(field, ASCENDING) for field in NATURAL_KEY],
                                    name='natural_key')
            # The list route's resting order, so a page of it is an index scan rather
            # than a blocking sort over 29,382 documents. _id is in the key because the
            # order has to be total -- see LIST_SORT in models/dwp_report.py.
            collection.create_index([('date', DESCENDING), ('_id', ASCENDING)])

    def import_all(self, directory='anonymized_data'):
        print(f"\n{'='*60}\nIMPORTING FROM {directory}\n{'='*60}")
        files = sorted(Path(directory).glob('**/*.xlsx'))
        if not files:
            print(f"[!!] No Excel files found in {directory}")
            return False

        self.stats['total_files'] = len(files)
        print(f"[ok] Found {len(files)} files\n")

        for i, f in enumerate(files, 1):
            print(f"[{i}/{len(files)}] {f.name}")
            try:
                self.import_file(str(f))
            except Exception as e:
                print(f"    [!!] {e}")
                self.stats['errors'] += 1

        return True

    def print_stats(self):
        print(f"\n{'='*60}\nIMPORT COMPLETE\n{'='*60}")
        print(f"Files:           {self.stats['total_files']}")
        print(f"New documents:   {self.stats['total_documents']}")
        print(f"Unchanged:       {self.stats['unchanged']}  (skipped -- re-import is a no-op)")
        print(f"Updated:         {self.stats['updated']}  (edited at the source, replaced in place)")
        if self.stats['repeated_in_file']:
            print(f"Repeated in file: {self.stats['repeated_in_file']}")
        if self.stats['ambiguous']:
            print(f"Ambiguous:       {self.stats['ambiguous']}  (key matched more than one row -- not written)")
        print(f"Errors:          {self.stats['errors']}")
        print(f"\nBy collection:")
        for name in ['dwp_reports', 'attendance_reports', 'enrollment_reports', 'student_reports', 'birthday_reports']:
            print(f"  {name}: {self.stats[name]}")

    def verify(self):
        print(f"\n{'='*60}\nVERIFICATION\n{'='*60}")
        for name in ['dwp_reports', 'attendance_reports', 'enrollment_reports', 'student_reports', 'birthday_reports']:
            count = self.db[name].count_documents({})
            print(f"  {name}: {count}")

    def close(self):
        self.client.close()


def main():
    importer = DataImporter()
    try:
        importer.db.command('ping')
        print("[ok] Connected to MongoDB")
        if importer.import_all('anonymized_data'):
            importer.print_stats()
            importer.verify()
    except Exception as e:
        print(f"[!!] {e}")
    finally:
        importer.close()


if __name__ == '__main__':
    main()
