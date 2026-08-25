"""
One-time migration: split stored center values into location and organization.

dwp_reports stores centers[] already parsed, so the parse_center fix in
import_reports.py only affects future imports. This rewrites what is already there:

    centers: ['Southlake, Mann Mathematics']
    ->  centers: ['Southlake'], center_orgs: ['Mann Mathematics']

The organization is the operating brand on the session's date -- every location switched
from 'Mann Mathematics' to 'Math Made Simple' on 2025-09-05 -- so leaving it inside the
center name splits one location's history into three names across the rebrand.

**row_hash is rewritten alongside the values**, for the same reason as
backfill_session_times.py: the hash covers the whole document, and a document whose
stored hash no longer describes it would be re-inserted rather than matched on the next
import of that row.

Splitting cannot merge two distinct rows, because center_orgs keeps what centers[] gave
up -- but the collision check runs anyway, since a genuine duplicate pair would still be
rejected by the unique index and is worth surfacing before the write, not during it.

Dry run by default. Re-run with --apply to commit.
"""

import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pymongo import MongoClient, UpdateOne
from mongo_url import uri, db_name
from import_reports import row_hash


TARGET_COLLECTION = 'dwp_reports'


def split_stored_center(value):
    """One stored center string -> (location, organization)."""
    location, _, org = str(value).partition(', ')
    return location.strip(), org.strip()


def needs_split(doc):
    return any(', ' in str(v) for v in doc.get('centers', []) or []) or 'center_orgs' not in doc


def backfill(apply=False):
    client = MongoClient(uri)
    db = client[db_name]
    collection = db[TARGET_COLLECTION]

    total = collection.count_documents({})
    docs = [d for d in collection.find() if needs_split(d)]
    print(f"{TARGET_COLLECTION}: {total} documents, {len(docs)} to rewrite")

    if not docs:
        print("\nNothing to do.")
        client.close()
        return True

    before = Counter()
    after = Counter()
    corrected = {}
    for doc in docs:
        centers, orgs = [], []
        for value in doc.get('centers', []) or []:
            before[str(value)] += 1
            location, org = split_stored_center(value)
            if location and location not in centers:
                centers.append(location)
            if org and org not in orgs:
                orgs.append(org)
        for location in centers:
            after[location] += 1

        fixed = dict(doc)
        fixed['centers'] = centers
        fixed['center_orgs'] = orgs
        corrected[doc['_id']] = (fixed, row_hash(fixed))

    print(f"  distinct center values: {len(before)} -> {len(after)}")
    for name, count in after.most_common():
        print(f"    {count:>6}  {name}")
    orgs_seen = Counter(
        org for fixed, _ in corrected.values() for org in fixed['center_orgs']
    )
    print(f"  organizations extracted: {len(orgs_seen)}")
    for name, count in orgs_seen.most_common():
        print(f"    {count:>6}  {name}")

    # Prove no two corrected documents collide, with each other or with a row left alone.
    by_hash = defaultdict(list)
    for _id, (_, h) in corrected.items():
        by_hash[h].append(_id)
    internal = {h: ids for h, ids in by_hash.items() if len(ids) > 1}

    # One projected pass over the collection, not a query per document: at this scale a
    # find_one per row -- each carrying a $nin of every touched _id -- does not finish.
    stored = {d['_id']: d.get('row_hash') for d in collection.find({}, {'row_hash': 1})}
    untouched = {h for _id, h in stored.items() if h and _id not in corrected}
    external = [(h, ids[0]) for h, ids in by_hash.items() if h in untouched]

    if internal or external:
        print(f"\n  *** ABORTED: rewriting these rows would create duplicates.")
        for h, ids in list(internal.items())[:5]:
            print(f"      {h[:12]}… x{len(ids)}: {[str(i) for i in ids[:4]]}")
        for h, mine in external[:5]:
            print(f"      {h[:12]}… {mine} would equal a row left untouched")
        client.close()
        return False

    print(f"  all {len(corrected)} rewritten rows hash distinctly")

    if not apply:
        print(f"\n  DRY RUN -- nothing written. Re-run with --apply to commit.")
        client.close()
        return True

    ops = [
        UpdateOne({'_id': _id}, {'$set': {
            'centers': fixed['centers'],
            'center_orgs': fixed['center_orgs'],
            'row_hash': h,
        }})
        for _id, (fixed, h) in corrected.items()
    ]
    result = collection.bulk_write(ops, ordered=False)
    print(f"  rewrote {result.modified_count} documents")

    remaining = collection.count_documents({'centers': {'$regex': ', '}})
    if remaining:
        print(f"  *** {remaining} documents still hold a comma in centers[]")
        client.close()
        return False

    print(f"  no unsplit center values remain")
    print(f"\n  Rebuild the aggregates now -- students, instructors and")
    print(f"  attendance_reports all copied the old center names.")
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
