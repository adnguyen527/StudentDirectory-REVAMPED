"""BSON -> JSON, shared by the blueprints.

json_util renders ObjectId and datetime as {"$oid": ...} / {"$date": ...} rather than
letting jsonify fail on them. Defined once so every route answers in the same dialect.
"""

import json

from bson import json_util


def serialize(value):
    """BSON (ObjectId, datetime) -> JSON-safe structures."""
    return json.loads(json_util.dumps(value))
