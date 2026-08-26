"""
One-time migration: add the `finalized` flag to rows imported before it existed.

finalized is `pages_completed is not None` -- see is_finalized() in import_reports.py for
why the page count, and not finalized_date, is the signal.

1,068 of 29,382 rows come out unfinalized. They are kept, not deleted: 968 of them are
the only record of that student-day, so dropping them would erase attendance for sessions
that demonstrably happened. The flag lets attendance count them while page-rate metrics
leave them out.

**row_hash is rewritten alongside the flag**, for the reason the other backfills give: the
hash covers the whole document, and one whose stored hash no longer describes it gets
re-inserted rather than matched on the next import.

The flag is a pure function of pages_completed, which is already inside the hash, so it
cannot merge two documents that were distinct before. The collision check runs anyway --
the unique index on row_hash would reject a genuine duplicate pair, and it is better to
find that before the write than during it.

Dry run by default. Re-run with --apply to commit.
"""

import sys
from collections import Counter, defaultdict
from pathlib import Path

# Repo root, three levels up now that these live in ingestion/migrations/.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pymongo import MongoClient, ASCENDING, UpdateOne
from mongo_url import uri, db_name
from ingestion.import_reports import is_finalized, row_hash


TARGET_COLLECTION = 'dwp_reports'


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    docs = [d for d in collection.find() if d.get('finalized') != is_finalized(d)]
    print(f"{TARGET_COLLECTION}: {total} documents, {len(docs)} to flag")

    if not docs:
        print("\nNothing to do.")
        client.close()
        return True

    corrected = {}
    tally = Counter()
    for doc in docs:
        fixed = dict(doc)
        fixed['finalized'] = is_finalized(doc)
        tally[fixed['finalized']] += 1
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    print(f"  finalized:   {tally[True]}")
    print(f"  unfinalized: {tally[False]}")

    # Cross-tab against finalized_date, the signal this flag deliberately does not use.
    cross = Counter(
        (fixed['finalized'], doc.get('finalized_date') is not None)
        for doc, (fixed, _) in zip(docs, corrected.values())
    )
    print(f"  of the unfinalized, {cross[(False, True)]} still carry a finalized_date")
    print(f"  of the finalized, {cross[(True, False)]} carry none")

    by_hash = defaultdict(list)
    for _id, (_, h) in corrected.items():
        by_hash[h].append(_id)
    internal = {h: ids for h, ids in by_hash.items() if len(ids) > 1}

    stored = {d['_id']: d.get('row_hash') for d in collection.find({}, {'row_hash': 1})}
    untouched = {h for _id, h in stored.items() if h and _id not in corrected}
    external = [(h, ids[0]) for h, ids in by_hash.items() if h in untouched]

    if internal or external:
        print(f"\n  *** ABORTED: flagging these rows would create duplicates.")
        for h, ids in list(internal.items())[:5]:
            print(f"      {h[:12]}... x{len(ids)}: {[str(i) for i in ids[:4]]}")
        for h, mine in external[:5]:
            print(f"      {h[:12]}... {mine} would equal a row left untouched")
        client.close()
        return False

    print(f"  all {len(corrected)} flagged rows hash distinctly")

    if not apply:
        print(f"\n  DRY RUN -- nothing written. Re-run with --apply to commit.")
        client.close()
        return True

    ops = [
        UpdateOne({'_id': _id}, {'$set': {'finalized': fixed['finalized'], 'row_hash': h}})
        for _id, (fixed, h) in corrected.items()
    ]
    result = collection.bulk_write(ops, ordered=False)
    print(f"  flagged {result.modified_count} documents")

    # Queried on every page-rate aggregation, and cheap at two values.
    collection.create_index([('finalized', ASCENDING)])

    remaining = collection.count_documents({'finalized': {'$exists': False}})
    if remaining:
        print(f"  *** {remaining} documents still unflagged")
        client.close()
        return False

    print(f"  every document carries the flag")
    print(f"\n  Rebuild the aggregates now -- students, instructors and")
    print(f"  attendance_reports all predate it.")
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
