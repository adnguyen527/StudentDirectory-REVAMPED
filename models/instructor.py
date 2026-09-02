import re

from pymongo import ASCENDING

from database import db
from models.filters import center_criteria


# The three arrays that grow with the dataset (272 dates, a 304-student roster and 504
# topics at the top end). None of them is shipped in a list -- with days_taught and
# students in it a page of 50 comes to 942 KB against 21 KB without.
# $project rather than $unset: the two are equivalent here, and mongomock -- which the
# offline tests run against -- has not implemented $unset.
LIST_PROJECTION = {'days_taught': 0, 'students': 0, 'topics': 0}

# The list shows a Students and a Days column, so those two counts are derived here at
# query time rather than stored on the document. $size reads the array server-side and
# only the number crosses the wire, which is what lets the count exist without the array:
# the page is byte-for-byte the size it was when the counters were stored fields.
#
# Nothing derives a topic count -- no list column asks for one.
LIST_COUNTS = {
    'unique_students': {'$size': '$students'},
    'total_days_taught': {'$size': '$days_taught'},
}

# One key suffices here, unlike students: instructor_name is unique, so nothing can tie.
LIST_SORT = [('instructor_name', ASCENDING)]


class Instructor:
    """Aggregated per-instructor profiles -- see ingestion/build_instructors.py.

    Keyed on instructor_name, because a name is all the source carries. Two people
    sharing a name merge into one document and nothing here can tell them apart.
    """

    @staticmethod
    def _collection():
        return db.get_db()['instructors']

    @staticmethod
    def _page(criteria, limit, offset):
        """(documents for this page, total matching the criteria) -- as Student._page.

        An aggregation rather than a find, because the two counts the list shows are
        computed from arrays it must not ship. $match/$sort/$skip/$limit come first so the
        sort still runs off instructor_name_1 and only this page's documents reach the
        $size stage.
        """
        collection = Instructor._collection()
        documents = list(collection.aggregate([
            {'$match': criteria},
            {'$sort': dict(LIST_SORT)},
            {'$skip': offset},
            {'$limit': limit},
            {'$addFields': LIST_COUNTS},
            {'$project': LIST_PROJECTION},
        ]))
        return documents, collection.count_documents(criteria)

    @staticmethod
    def find_all(limit, offset=0, centers=None):
        return Instructor._page(center_criteria(centers), limit, offset)

    @staticmethod
    def find_by_name(instructor_name):
        """One instructor, roster and days included -- exact match on the unique index."""
        return Instructor._collection().find_one({'instructor_name': instructor_name})

    @staticmethod
    def search(query, limit, offset=0, centers=None):
        # re.escape: the query reaches $regex directly -- see Student._name_criteria.
        criteria = {
            'instructor_name': {'$regex': re.escape(query), '$options': 'i'},
            **center_criteria(centers),
        }
        return Instructor._page(criteria, limit, offset)

    @staticmethod
    def center_names():
        """Distinct center names on this collection, for the filter's checkbox list."""
        return set(Instructor._collection().distinct('centers.name'))

    @staticmethod
    def count_all():
        return Instructor._collection().count_documents({})
