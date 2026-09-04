import re

from pymongo import ASCENDING, DESCENDING

from database import db
from models.filters import range_criteria
from models.sorting import build_order


# The one array that grows with the dataset (82 instructors on the widest topic, 16,932
# roster entries across the collection). Only read on the detail view, which is the only
# place that asks who taught a topic -- the list shows no instructor column. This is the
# same omission that took the instructors list from 757 KB to 21 KB.
LIST_PROJECTION = {'instructors': 0}

# Most worked first: the top of a 771-row list should be the topics the program actually
# spends its time on, not whatever starts with "1".
#
# skip/limit over an unsorted cursor can repeat or drop a document, so the sort has to be
# total, and session counts tie constantly -- 670 of 771 topics share theirs with another,
# and 37 sit together on two sessions. topic_id breaks those ties, and the compound index
# in ingestion/build_topics.py keeps the whole thing an index scan rather than a blocking
# in-memory sort.
LIST_SORT = [('sessions', DESCENDING), ('topic_id', ASCENDING)]

# The columns the list page can be sorted by -- as Student.SORTABLE. The Topic column
# sorts by name; the id under it is a tie-break rather than an order anyone asks for.
SORTABLE = {
    'name': ('name', ASCENDING),
    'sessions': ('sessions', DESCENDING),
    'students': ('unique_students', DESCENDING),
    'finished': ('students_finished', DESCENDING),
    'on_plan': ('students_on_plan', DESCENDING),
    'removed': ('students_removed', DESCENDING),
    'median': ('median_sessions_to_finish', DESCENDING),
    'reassigned': ('total_reassignments', DESCENDING),
}

# 90 names are carried by more than one topic, so the name cannot break its own ties.
TIE_BREAK = 'topic_id'

# The one sortable field that is null rather than 0 when it has no value: 109 of 771
# topics have never been finished by anybody, so there is no median for them. Mongo sorts
# null below every number, which would open an ascending Median sort with 109 dashes --
# the rows with the least to say about the column being sorted by.
NULLABLE = {'median_sessions_to_finish'}

# Where that gets fixed. Sorted on first, so a missing value sits at the bottom whichever
# way the column runs, and dropped again before the document is serialized.
MISSING_FLAG = '_missing'


# As Student.FILTERABLE. No date column: the list shows none, and first_taught and
# last_taught are on the detail page rather than here.
#
# ⚠️ A median bound drops the 109 topics that have no median at all, since null satisfies
# neither end -- see range_criteria. Correct, and the popover has to say so.
FILTERABLE = {
    'sessions': ('sessions', 'number'),
    'students': ('unique_students', 'number'),
    'finished': ('students_finished', 'number'),
    'on_plan': ('students_on_plan', 'number'),
    'removed': ('students_removed', 'number'),
    'median': ('median_sessions_to_finish', 'number'),
    'reassigned': ('total_reassignments', 'number'),
}


def sort_order(sort=None, direction=None):
    return build_order(sort, direction, SORTABLE, TIE_BREAK, LIST_SORT)


class Topic:
    """Program-wide per-topic rollups -- see ingestion/build_topics.py.

    Keyed on topic_id alone, one document per topic, because a list that shows a topic
    twice is not a list. A topic the source spells more than one way keeps the names not
    chosen in also_known_as, and search covers those as well as the id: someone looking
    for a renamed topic by its old name, or reaching for `PK-3121`, has to find it.
    """

    @staticmethod
    def _collection():
        return db.get_db()['topics']

    @staticmethod
    def _page(criteria, limit, offset, order=None):
        """(documents for this page, total matching the criteria) -- as Student._page.

        A plain find, except when the column being sorted by can be null: that one needs
        a computed key to keep the empty rows at the bottom, which a find cannot express.
        Every other order -- including the default -- stays on its index.
        """
        order = order or LIST_SORT
        collection = Topic._collection()

        if order[0][0] in NULLABLE:
            documents = list(collection.aggregate([
                {'$match': criteria},
                {'$addFields': {
                    MISSING_FLAG: {'$cond': [{'$eq': [f'${order[0][0]}', None]}, 1, 0]}
                }},
                # Insertion order matters: the flag has to be the leading key.
                {'$sort': {MISSING_FLAG: ASCENDING, **dict(order)}},
                {'$skip': offset},
                {'$limit': limit},
                {'$project': {**LIST_PROJECTION, MISSING_FLAG: 0}},
            ]))
        else:
            # A copy, not the constant itself: mongomock -- which the offline tests run
            # against -- mutates the projection dict it is handed, adding {'_id': 1}.
            # find() tolerates the result; the $project above would refuse it, and the
            # two build from the same dict.
            documents = list(
                collection.find(criteria, dict(LIST_PROJECTION))
                .sort(order)
                .skip(offset)
                .limit(limit)
            )
        return documents, collection.count_documents(criteria)

    @staticmethod
    def _search_criteria(query):
        """Match the topic's current name, the names it no longer goes by, or its id.

        The id is in here because it is a handle staff actually use, and because the list
        page shows it -- 90 names are carried by more than one topic, so the id is what
        tells those rows apart, and a list that displays ids but cannot search them is
        incoherent. Case-insensitive, so `pk-3121` finds `PK-3121-00`.

        The pattern is unanchored, so the unique topic_id index does not serve this; at
        771 documents the collection scan is not worth an index to avoid.
        """
        # re.escape: the query reaches $regex directly -- see Student._name_criteria.
        # also_known_as is an array, and $regex matches if any element does, so one
        # pattern covers both the chosen name and the ones it replaced.
        pattern = {'$regex': re.escape(query), '$options': 'i'}
        return {
            '$or': [{'name': pattern}, {'also_known_as': pattern}, {'topic_id': pattern}]
        }

    @staticmethod
    def find_all(limit, offset=0, sort=None, direction=None, ranges=None):
        return Topic._page(
            range_criteria(ranges, FILTERABLE), limit, offset, sort_order(sort, direction)
        )

    @staticmethod
    def find_by_id(topic_id):
        """One topic, its instructor ranking included -- exact match on the unique index."""
        return Topic._collection().find_one({'topic_id': topic_id})

    @staticmethod
    def search(query, limit, offset=0, sort=None, direction=None, ranges=None):
        return Topic._page(
            {**Topic._search_criteria(query), **range_criteria(ranges, FILTERABLE)},
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def count_all():
        return Topic._collection().count_documents({})
