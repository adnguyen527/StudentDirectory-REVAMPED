"""
One-time migration: turn session_start / session_end into datetimes.

    date: 2025-01-02, session_start: '3:58 PM'  ->  session_start: 2025-01-02 15:58

A clock reading with no date attached cannot be sorted, ranged or subtracted without
first knowing which day it belongs to. Every consumer was rejoining the two halves --
build_attendance.py did it to measure a session, and any query about time of day had to
reparse 29,382 strings. The join now happens once, at import.

Rows whose session_end is null stay null: 217 sessions have no recorded end time at all
(see the README's Known Issues), and this migration does not invent one.

**row_hash is rewritten alongside the values**, for the reason the other backfills give.

After this, `attendance_reports` can be rebuilt but does not have to be -- the datetimes
it stores were already derived from these same values, so the rebuild is a no-op in
content. Rebuild only if you want the run to prove it.

Dry run by default. Re-run with --apply to commit.
"""

import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# Repo root, three levels up now that these live in ingestion/migrations/.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pymongo import MongoClient, UpdateOne
from mongo_url import uri, db_name
from ingestion.import_reports import combine_session_time, row_hash


TARGET_COLLECTION = 'dwp_reports'
TIME_FIELDS = ['session_start', 'session_end']


def _needs_conversion(doc):
    return any(
        doc.get(f) is not None and not isinstance(doc.get(f), datetime)
        for f in TIME_FIELDS
    )


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    docs = [d for d in collection.find() if _needs_conversion(d)]
    print(f"{TARGET_COLLECTION}: {total} documents, {len(docs)} with string session times")
    for field in TIME_FIELDS:
        print(f"  {field}: "
              f"{collection.count_documents({field: {'$type': 'string'}})} string, "
              f"{collection.count_documents({field: {'$type': 'date'}})} date, "
              f"{collection.count_documents({field: None})} null")

    if not docs:
        print("\nNothing to do.")
        client.close()
        return True

    # Convert everything before writing anything. A value this cannot read would
    # otherwise be nulled, turning an unreadable time into a missing one -- and missing
    # is a claim this data already makes about 217 real sessions.
    corrected = {}
    unconvertible = []
    for doc in docs:
        fixed = dict(doc)
        for field in TIME_FIELDS:
            raw = doc.get(field)
            if raw is None or isinstance(raw, datetime):
                continue
            joined = combine_session_time(doc.get('date'), raw)
            if joined is None:
                unconvertible.append((doc['_id'], field, raw, doc.get('date')))
            fixed[field] = joined
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    if unconvertible:
        print(f"\n  *** ABORTED: {len(unconvertible)} value(s) cannot be joined to a date.")
        for _id, field, raw, day in unconvertible[:5]:
            print(f"      {_id}: {field}={raw!r} date={day!r}")
        print(f"      Either the time is unreadable or the row has no date. Fix first.")
        client.close()
        return False

    starts = [f['session_start'] for f, _ in corrected.values() if f.get('session_start')]
    print(f"  all {len(corrected)} rows convert")
    print(f"  session_start range: {min(starts)} -> {max(starts)}")

    by_hash = defaultdict(list)
    for _id, (_, h) in corrected.items():
        by_hash[h].append(_id)
    internal = {h: ids for h, ids in by_hash.items() if len(ids) > 1}

    stored = {d['_id']: d.get('row_hash') for d in collection.find({}, {'row_hash': 1})}
    untouched = {h for _id, h in stored.items() if h and _id not in corrected}
    external = [(h, ids[0]) for h, ids in by_hash.items() if h in untouched]

    if internal or external:
        print(f"\n  *** ABORTED: rewriting these rows would create duplicates.")
        for h, ids in list(internal.items())[:5]:
            print(f"      {h[:12]}... x{len(ids)}: {[str(i) for i in ids[:4]]}")
        for h, mine in external[:5]:
            print(f"      {h[:12]}... {mine} would equal a row left untouched")
        client.close()
        return False

    print(f"  all {len(corrected)} rewritten rows hash distinctly")

    if not apply:
        print(f"\n  DRY RUN -- nothing written. Re-run with --apply to commit.")
        client.close()
        return True

    ops = [
        UpdateOne({'_id': _id}, {'$set': {
            'session_start': fixed['session_start'],
            'session_end': fixed['session_end'],
            'row_hash': h,
        }})
        for _id, (fixed, h) in corrected.items()
    ]
    result = collection.bulk_write(ops, ordered=False)
    print(f"  converted {result.modified_count} documents")

    remaining = sum(
        collection.count_documents({f: {'$type': 'string'}}) for f in TIME_FIELDS
    )
    if remaining:
        print(f"  *** {remaining} session time(s) are still strings")
        client.close()
        return False

    print(f"  every session time is a datetime or null")
    client.close()
    return True


def main():
    apply = '--apply' in sys.argv
    print(f"{'APPLYING' if apply else 'DRY RUN'}\n")
    ok = backfill(apply=apply)
    print(f"\n{'Done.' if ok else 'FAILED -- see above.'}")
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
