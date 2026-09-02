import re

from pymongo import ASCENDING

from database import db


# The three arrays that grow with the dataset (272 dates, a 304-student roster and 504
# topics at the top end). Only read on the detail view; total_days_taught, unique_students
# and unique_topics_taught stand in. Leaving topics[] in took the full list response to
# 757 KB against the students list's 30 KB.
LIST_PROJECTION = {'days_taught': 0, 'students': 0, 'topics': 0}

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
        # re.escape: the query reaches $regex directly -- see Student._name_criteria.
        criteria = {'instructor_name': {'$regex': re.escape(query), '$options': 'i'}}
        return Instructor._page(criteria, limit, offset)

    @staticmethod
    def count_all():
        return Instructor._collection().count_documents({})
