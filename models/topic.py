import re

from pymongo import ASCENDING, DESCENDING

from database import db


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
    def _page(criteria, limit, offset):
        """(documents for this page, total matching the criteria) -- as Student._page."""
        collection = Topic._collection()
        documents = list(
            collection.find(criteria, LIST_PROJECTION)
            .sort(LIST_SORT)
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
    def find_all(limit, offset=0):
        return Topic._page({}, limit, offset)

    @staticmethod
    def find_by_id(topic_id):
        """One topic, its instructor ranking included -- exact match on the unique index."""
        return Topic._collection().find_one({'topic_id': topic_id})

    @staticmethod
    def search(query, limit, offset=0):
        return Topic._page(Topic._search_criteria(query), limit, offset)

    @staticmethod
    def count_all():
        return Topic._collection().count_documents({})
