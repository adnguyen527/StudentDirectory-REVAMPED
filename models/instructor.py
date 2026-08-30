import re

from pymongo import ASCENDING

from database import db


# days_taught and students are the two arrays that grow with the dataset -- 272 dates and
# a 304-student roster at the top end of the current data. Both are only read on the
# detail view, so list results project them out and lean on the counts stored beside
# them, total_days_taught and unique_students, which say the same thing in one number.
LIST_PROJECTION = {'days_taught': 0, 'students': 0}

# One key is enough to page stably here, unlike students: instructor_name carries a unique
# index, so no two documents can tie and the sort is already covered.
LIST_SORT = [('instructor_name', ASCENDING)]


class Instructor:
    """Aggregated per-instructor profiles -- see ingestion/build_instructors.py.

    Keyed on instructor_name, because a name is all the source data carries. Two people
    sharing a name merge into one document and nothing here can tell them apart.
    """

    @staticmethod
    def _collection():
        return db.get_db()['instructors']

    @staticmethod
    def _page(criteria, limit, offset):
        """(documents for this page, total matching the criteria) -- as Student._page."""
        collection = Instructor._collection()
        documents = list(
            collection.find(criteria, LIST_PROJECTION)
            .sort(LIST_SORT)
            .skip(offset)
            .limit(limit)
        )
        return documents, collection.count_documents(criteria)

    @staticmethod
    def find_all(limit, offset=0):
        return Instructor._page({}, limit, offset)

    @staticmethod
    def find_by_name(instructor_name):
        """One instructor, roster and days included -- exact match on the unique index."""
        return Instructor._collection().find_one({'instructor_name': instructor_name})

    @staticmethod
    def search(query, limit, offset=0):
        # re.escape for the same reason as Student.search: the query reaches $regex
        # directly, so an unescaped input can be crafted into a pathological pattern.
        criteria = {'instructor_name': {'$regex': re.escape(query), '$options': 'i'}}
        return Instructor._page(criteria, limit, offset)

    @staticmethod
    def count_all():
        return Instructor._collection().count_documents({})
