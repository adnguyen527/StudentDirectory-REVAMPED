"""
One-time migration: add row_hash to documents imported before idempotency existed.

import_reports.py keys its upserts on row_hash and enforces a unique index on it.
Documents written before that change have no row_hash, and a unique index would read
them all as null -- i.e. as duplicates of each other -- so it cannot be created until
they are backfilled.

Verifies every hash is distinct BEFORE writing anything, and aborts untouched if not.
Safe to re-run: documents that already carry the correct hash are skipped.
"""

import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, ASCENDING, UpdateOne
from mongo_url import uri, db_name
from import_reports import row_hash


TARGET_COLLECTIONS = ['dwp_reports']


def backfill(collection_name, apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[collection_name]

    total = collection.count_documents({})
    missing = collection.count_documents({'row_hash': {'$exists': False}})
    print(f"{collection_name}: {total} documents, {missing} without row_hash")
    if total == 0:
        client.close()
        return True

    # Pass 1: compute every hash and prove they are distinct before writing anything.
    seen = defaultdict(list)
    ops = []
    for doc in collection.find():
        h = row_hash(doc)
        seen[h].append(doc['_id'])
        if doc.get('row_hash') != h:
            ops.append(UpdateOne({'_id': doc['_id']}, {'$set': {'row_hash': h}}))

    collisions = {h: ids for h, ids in seen.items() if len(ids) > 1}
    print(f"  distinct hashes: {len(seen)} / {total}")
    print(f"  documents needing a write: {len(ops)}")

    if collisions:
        print(f"\n  *** ABORTED: {len(collisions)} hash collisions -- these documents are")
        print(f"      byte-identical and a unique index would reject them.")
        for h, ids in list(collisions.items())[:5]:
            print(f"        {h[:12]}... x{len(ids)}: {[str(i) for i in ids[:4]]}")
        print(f"      Resolve the duplicates first, then re-run.")
        client.close()
        return False

    if not apply:
        print(f"\n  DRY RUN -- nothing written. Re-run with --apply to commit.")
        client.close()
        return True

    # Pass 2: write.
    if ops:
        result = collection.bulk_write(ops, ordered=False)
        print(f"  wrote row_hash to {result.modified_count} documents")
    else:
        print(f"  nothing to write -- all documents already hashed")

    still_missing = collection.count_documents({'row_hash': {'$exists': False}})
    if still_missing:
        print(f"  *** {still_missing} documents still lack row_hash -- index NOT created")
        client.close()
        return False

    collection.create_index([('row_hash', ASCENDING)], unique=True)
    print(f"  unique index on row_hash created")
    client.close()
    return True


def main():
    apply = '--apply' in sys.argv
    print(f"{'APPLYING' if apply else 'DRY RUN'}\n")
    ok = all(backfill(name, apply=apply) for name in TARGET_COLLECTIONS)
    print(f"\n{'Done.' if ok else 'FAILED -- see above.'}")
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
