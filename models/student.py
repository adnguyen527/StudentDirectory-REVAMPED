import re

from pymongo import ASCENDING

from database import db
from models.filters import center_criteria


# Three arrays that grow with every session and are only needed on the detail view.
# Excluding them took the full list response from 1.08 MB to 0.54 MB; the
# total_unique_* counters stay behind to answer what a list view asks.
LIST_PROJECTION = {'dwp_report_ids': 0, 'topics': 0, 'instructors': 0}

# skip/limit over an unsorted cursor can repeat or drop a document. student_name alone
# is not enough either -- 17 students share a name -- so student_key breaks the ties.
# The compound index in build_students.py keeps this an index scan.
LIST_SORT = [('student_name', ASCENDING), ('student_key', ASCENDING)]


class Student:

    @staticmethod
    def _collection():
        return db.get_db()['students']

    @staticmethod
    def _page(criteria, limit, offset):
        """(documents for this page, total matching the criteria).

        The total is counted separately so a caller can size a pager on the first request.
        """
        collection = Student._collection()
        documents = list(
            collection.find(criteria, LIST_PROJECTION)
            .sort(LIST_SORT)
            .skip(offset)
            .limit(limit)
        )
        return documents, collection.count_documents(criteria)

    @staticmethod
    def _name_criteria(query):
        # re.escape: the query reaches $regex directly, so an unescaped input can
        # otherwise be crafted into a pathological pattern.
        return {'student_name': {'$regex': re.escape(query), '$options': 'i'}}

    @staticmethod
    def find_all(limit, offset=0, centers=None):
        return Student._page(center_criteria(centers), limit, offset)

    @staticmethod
    def find_by_key(student_key):
        """One student. student_key is account_id + slugified name -- see util.py."""
        return Student._collection().find_one({'student_key': student_key})

    @staticmethod
    def find_by_account(account_id, limit, offset=0, centers=None):
        """Every student on one household account, i.e. a set of siblings."""
        return Student._page(
            {'account_id': account_id, **center_criteria(centers)}, limit, offset
        )

    @staticmethod
    def search(query, limit, offset=0, centers=None):
        # Different keys, so the two criteria merge into one AND.
        return Student._page(
            {**Student._name_criteria(query), **center_criteria(centers)}, limit, offset
        )

    @staticmethod
    def center_names():
        """Distinct center names on this collection, for the filter's checkbox list."""
        return set(Student._collection().distinct('centers.name'))

    @staticmethod
    def count_all():
        return Student._collection().count_documents({})
