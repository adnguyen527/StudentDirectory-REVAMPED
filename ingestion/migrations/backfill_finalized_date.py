"""
One-time migration: turn finalized_date from a packed string into a real datetime.

The source writes the date and the time of finalization into one cell:

    ' 01/02/2025 \\n 3:59 PM'   ->   datetime(2025, 1, 2, 15, 59)

Stored raw, it is a string that cannot be sorted or range-queried, so "which reports were
closed out late" or "what happened after 8pm" needs reparsing at query time, every time.

All 27,839 non-null values in the current data parse; 1,543 rows have no finalized_date
at all and stay null. No aggregate carries this field, so nothing needs rebuilding after.

**row_hash is rewritten alongside the value**, for the reason the other backfills give.

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
from ingestion.import_reports import _parse_finalized_date, row_hash


TARGET_COLLECTION = 'dwp_reports'
FIELD = 'finalized_date'


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    docs = [
        d for d in collection.find()
        if d.get(FIELD) is not None and not isinstance(d.get(FIELD), datetime)
    ]
    print(f"{TARGET_COLLECTION}: {total} documents, {len(docs)} with a string {FIELD}")
    print(f"  already datetime: {collection.count_documents({FIELD: {'$type': 'date'}})}")
    print(f"  null: {collection.count_documents({FIELD: None})}")

    if not docs:
        print("\nNothing to do.")
        client.close()
        return True

    # Parse everything before writing anything: a value this cannot read would otherwise
    # be silently nulled, turning an unreadable timestamp into a missing one.
    corrected = {}
    unparsed = []
    for doc in docs:
        parsed = _parse_finalized_date(doc[FIELD])
        if parsed is None:
            unparsed.append((doc['_id'], doc[FIELD]))
            continue
        fixed = dict(doc)
        fixed[FIELD] = parsed
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    if unparsed:
        print(f"\n  *** ABORTED: {len(unparsed)} value(s) do not parse.")
        for _id, value in unparsed[:5]:
            print(f"      {_id}: {value!r}")
        print(f"      Nulling these would lose information. Teach the parser first.")
        client.close()
        return False

    parsed_values = [fixed[FIELD] for fixed, _ in corrected.values()]
    print(f"  all {len(corrected)} values parse")
    print(f"  range: {min(parsed_values)} -> {max(parsed_values)}")

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
        UpdateOne({'_id': _id}, {'$set': {FIELD: fixed[FIELD], 'row_hash': h}})
        for _id, (fixed, h) in corrected.items()
    ]
    result = collection.bulk_write(ops, ordered=False)
    print(f"  converted {result.modified_count} documents")

    remaining = collection.count_documents({FIELD: {'$type': 'string'}})
    if remaining:
        print(f"  *** {remaining} documents still hold a string {FIELD}")
        client.close()
        return False

    print(f"  every {FIELD} is a datetime or null")
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
