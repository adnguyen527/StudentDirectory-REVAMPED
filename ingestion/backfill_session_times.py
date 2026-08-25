"""
One-time migration: turn the stored string 'None' in session_start / session_end into a
real null, for rows imported before parse_session ran them through _none().

217 dwp_reports carry 'None' as session_end -- a time-shaped field holding a value that
is not a time. The parser fix in import_reports.py stops new rows arriving that way; this
fixes the ones already stored.

**row_hash is rewritten alongside the value.** The hash covers the whole document, so
correcting a field without rehashing would leave a document whose stored hash no longer
describes it -- and the next import of that same source row would compute the corrected
hash, fail to find it, and insert a duplicate beside it.

Two documents that differ only in this field become identical once both are corrected.
That is a real duplicate, and the unique index on row_hash would reject it. This script
detects that case BEFORE writing and aborts untouched, listing the pairs, rather than
half-applying and leaving the collection in a state neither version describes.

Dry run by default. Re-run with --apply to commit.
"""

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, UpdateOne
from mongo_url import uri, db_name
from import_reports import row_hash


TARGET_COLLECTION = 'dwp_reports'
TIME_FIELDS = ['session_start', 'session_end']

# The stored value that should have been a null. Matched exactly -- a real time is never
# whitespace-padded in this data, and a broader match risks eating legitimate values.
PLACEHOLDER = 'None'


def _affected_query():
    return {'$or': [{field: PLACEHOLDER} for field in TIME_FIELDS]}


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    affected = list(collection.find(_affected_query()))
    print(f"{TARGET_COLLECTION}: {total} documents, {len(affected)} carrying '{PLACEHOLDER}'")
    for field in TIME_FIELDS:
        count = collection.count_documents({field: PLACEHOLDER})
        print(f"  {field}: {count}")

    if not affected:
        print("\nNothing to do.")
        client.close()
        return True

    # Pass 1: compute the corrected documents and their hashes, and prove no two of them
    # collide -- with each other, or with a document already stored.
    corrected = {}
    for doc in affected:
        fixed = dict(doc)
        for field in TIME_FIELDS:
            if fixed.get(field) == PLACEHOLDER:
                fixed[field] = None
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    by_hash = defaultdict(list)
    for _id, (_, h) in corrected.items():
        by_hash[h].append(_id)

    internal = {h: ids for h, ids in by_hash.items() if len(ids) > 1}

    untouched_ids = {doc['_id'] for doc in affected}
    external = []
    for h, ids in by_hash.items():
        clash = collection.find_one(
            {'row_hash': h, '_id': {'$nin': list(untouched_ids)}}, {'_id': 1}
        )
        if clash:
            external.append((h, ids[0], clash['_id']))

    if internal or external:
        print(f"\n  *** ABORTED: correcting these rows would create duplicates.")
        for h, ids in list(internal.items())[:5]:
            print(f"      {h[:12]}… x{len(ids)}: {[str(i) for i in ids[:4]]}")
        for h, mine, theirs in external[:5]:
            print(f"      {h[:12]}… {mine} would equal existing {theirs}")
        print(f"      These are genuinely the same row twice. Resolve them first.")
        client.close()
        return False

    print(f"  all {len(corrected)} corrected rows hash distinctly")

    if not apply:
        print(f"\n  DRY RUN -- nothing written. Re-run with --apply to commit.")
        client.close()
        return True

    # Pass 2: write the value and its hash together. Split across two writes, a failure
    # between them would leave documents whose hash does not describe them.
    ops = []
    for _id, (fixed, h) in corrected.items():
        update = {field: fixed[field] for field in TIME_FIELDS if field in fixed}
        update['row_hash'] = h
        ops.append(UpdateOne({'_id': _id}, {'$set': update}))

    result = collection.bulk_write(ops, ordered=False)
    print(f"  corrected {result.modified_count} documents")

    remaining = collection.count_documents(_affected_query())
    if remaining:
        print(f"  *** {remaining} documents still carry '{PLACEHOLDER}'")
        client.close()
        return False

    print(f"  no '{PLACEHOLDER}' values remain")
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
