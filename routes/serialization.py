"""BSON -> JSON, shared by the blueprints.

json_util renders ObjectId and datetime as {"$oid": ...} / {"$date": ...} rather than
letting jsonify fail on them. Defined once so every route answers in the same dialect.

A `$date` here is not an instant. The stored datetimes are naive -- a wall clock the
center wrote down, which Mongo keeps as UTC -- so json_util stamps a Z on a value that
never had a zone. A client that converts one to local time corrupts it: 5:53 PM becomes
12:53 PM in US Central, and a date at midnight lands on the day before. Render them in
UTC. See combine_session_time in ingestion/import_reports.py for why they are this way,
and frontend/src/api/bson.ts for the consuming end.

The exception is `last_modified` on the built aggregates, which the builders set with
datetime.now(timezone.utc) -- a real instant, and the only one in the data. It is a
build timestamp rather than something the source recorded, so it is genuinely comparable
across zones. Everything that came off a report is not.
"""

import json

from bson import json_util


def serialize(value):
    """BSON (ObjectId, datetime) -> JSON-safe structures."""
    return json.loads(json_util.dumps(value))
