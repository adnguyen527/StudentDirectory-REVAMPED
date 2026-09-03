import re

from pymongo import ASCENDING, DESCENDING

from database import db
from models.filters import center_criteria, range_criteria
from models.sorting import build_order


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

# The columns the list page can be sorted by -- as Student.SORTABLE, and an allowlist for
# the same reason. Center is absent here too, and more emphatically: 11 instructors work
# at several, so a row has no one center to be ordered by.
SORTABLE = {
    'name': ('instructor_name', ASCENDING),
    'sessions': ('total_sessions_taught', DESCENDING),
    'students': ('unique_students', DESCENDING),
    'days': ('total_days_taught', DESCENDING),
    'unfinalized': ('unfinalized_sessions', DESCENDING),
    'last_session': ('last_session_date', DESCENDING),
}

# instructor_name is unique here, so it breaks every tie by itself.
TIE_BREAK = 'instructor_name'


# As Student.FILTERABLE. Students and Days are absent: they are $size of arrays rather
# than stored fields, so a range on them cannot be matched before the pipeline computes
# them -- which would mean sizing every document in the collection to filter it. Sorting
# by them is one page's worth of that cost; filtering by them is the whole collection's.
FILTERABLE = {
    'sessions': ('total_sessions_taught', 'number'),
    'unfinalized': ('unfinalized_sessions', 'number'),
    'last_session': ('last_session_date', 'date'),
}


def sort_order(sort=None, direction=None):
    return build_order(sort, direction, SORTABLE, TIE_BREAK, LIST_SORT)


class Instructor:
    """Aggregated per-instructor profiles -- see ingestion/build_instructors.py.

    Keyed on instructor_name, because a name is all the source carries. Two people
    sharing a name merge into one document and nothing here can tell them apart.
    """

    @staticmethod
    def _collection():
        return db.get_db()['instructors']

    @staticmethod
    def _page(criteria, limit, offset, order=None):
        """(documents for this page, total matching the criteria) -- as Student._page.

        An aggregation rather than a find, because the two counts the list shows are
        computed from arrays it must not ship. $match/$sort/$skip/$limit come first so the
        sort still runs off instructor_name_1 and only this page's documents reach the
        $size stage.

        Sorting by one of those two counts is the exception: a field cannot be sorted by
        before it exists, so $addFields moves ahead of $sort and every matched document
        is sized rather than just this page's. That is the cost of deriving the counts
        instead of storing them, and at 103 instructors it is not measurable -- but it is
        why Students and Days are the two columns here that cannot ride an index.
        """
        order = order or LIST_SORT
        derived = any(field in LIST_COUNTS for field, _ in order)

        pipeline = [{'$match': criteria}]
        if derived:
            pipeline.append({'$addFields': LIST_COUNTS})
        pipeline += [
            {'$sort': dict(order)},
            {'$skip': offset},
            {'$limit': limit},
        ]
        if not derived:
            pipeline.append({'$addFields': LIST_COUNTS})
        pipeline.append({'$project': LIST_PROJECTION})

        collection = Instructor._collection()
        documents = list(collection.aggregate(pipeline))
        return documents, collection.count_documents(criteria)

    @staticmethod
    def find_all(limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        return Instructor._page(
            {**center_criteria(centers), **range_criteria(ranges, FILTERABLE)},
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def find_by_name(instructor_name):
        """One instructor, roster and days included -- exact match on the unique index."""
        return Instructor._collection().find_one({'instructor_name': instructor_name})

    @staticmethod
    def search(query, limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        # re.escape: the query reaches $regex directly -- see Student._name_criteria.
        criteria = {
            'instructor_name': {'$regex': re.escape(query), '$options': 'i'},
            **center_criteria(centers),
            **range_criteria(ranges, FILTERABLE),
        }
        return Instructor._page(criteria, limit, offset, sort_order(sort, direction))

    @staticmethod
    def center_names():
        """Distinct center names on this collection, for the filter's checkbox list."""
        return set(Instructor._collection().distinct('centers.name'))

    @staticmethod
    def count_all():
        return Instructor._collection().count_documents({})
