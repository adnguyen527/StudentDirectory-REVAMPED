"""
One-time migration: strip anonymization-placeholder names out of instructors[].

The name mapping assigned a real-looking name to rows whose instructor was empty in the
source. The result is a person who does not exist, holding 73 sessions and a roster of 69
students -- and, worse, no row anywhere with an empty instructors list, which turned
build_instructors.py's "no instructor named" guard into a no-op.

This rewrites those rows to instructors: [], which is what the source actually said.

The sessions are NOT deleted. An unattributed session still happened: the student was
there, pages were completed on 24 of the 73, and students / attendance_reports count them
in full. Only the attribution is void, so only build_instructors.py -- which skips rows
with no instructor -- changes its answer.

**row_hash is rewritten alongside the field**, for the reason the other backfills give.

Dry run by default. Re-run with --apply to commit.
"""

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, UpdateOne
from mongo_url import uri, db_name
from import_reports import PLACEHOLDER_INSTRUCTORS, row_hash


TARGET_COLLECTION = 'dwp_reports'


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    docs = list(collection.find({'instructors': {'$in': list(PLACEHOLDER_INSTRUCTORS)}}))
    print(f"{TARGET_COLLECTION}: {total} documents, {len(docs)} naming a placeholder")
    print(f"  placeholders: {sorted(PLACEHOLDER_INSTRUCTORS)}")

    if not docs:
        print("\nNothing to do.")
        client.close()
        return True

    corrected = {}
    outcome = Counter()
    for doc in docs:
        kept = [n for n in doc.get('instructors', []) if n not in PLACEHOLDER_INSTRUCTORS]
        outcome['emptied' if not kept else 'partially stripped'] += 1
        fixed = dict(doc)
        fixed['instructors'] = kept
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    print(f"  left with no instructor: {outcome['emptied']}")
    print(f"  keeping a real instructor: {outcome['partially stripped']}")
    print(f"  unfinalized among them: {sum(1 for d in docs if not d.get('finalized'))}")
    print(f"  pages on these rows: {sum(d.get('pages_completed') or 0 for d in docs)}")

    by_hash = defaultdict(list)
    for _id, (_, h) in corrected.items():
        by_hash[h].append(_id)
    internal = {h: ids for h, ids in by_hash.items() if len(ids) > 1}

    stored = {d['_id']: d.get('row_hash') for d in collection.find({}, {'row_hash': 1})}
    untouched = {h for _id, h in stored.items() if h and _id not in corrected}
    external = [(h, ids[0]) for h, ids in by_hash.items() if h in untouched]

    if internal or external:
        print(f"\n  *** ABORTED: stripping these rows would create duplicates.")
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
        UpdateOne({'_id': _id}, {'$set': {'instructors': fixed['instructors'], 'row_hash': h}})
        for _id, (fixed, h) in corrected.items()
    ]
    result = collection.bulk_write(ops, ordered=False)
    print(f"  rewrote {result.modified_count} documents")

    remaining = collection.count_documents(
        {'instructors': {'$in': list(PLACEHOLDER_INSTRUCTORS)}}
    )
    if remaining:
        print(f"  *** {remaining} documents still name a placeholder")
        client.close()
        return False

    unattributed = collection.count_documents({'instructors': []})
    print(f"  no placeholder names remain; {unattributed} rows are now unattributed")
    print(f"\n  Rebuild all three aggregates -- students and attendance_reports embed")
    print(f"  instructor names too, so the name survives there until they are rebuilt.")
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
