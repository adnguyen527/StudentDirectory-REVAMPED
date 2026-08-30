import re

from pymongo import ASCENDING

from database import db


# Three arrays that grow with every session and are only read on one student's detail
# view: dwp_report_ids is a list of ObjectId references, topics is the per-topic history,
# and instructors is everyone who has ever taught them -- a median of 9 names and up to
# 23, which was half the weight of the whole list response on its own. Excluding them
# keeps a page of rows small; total_unique_topics_finished and its siblings stay behind
# to answer the summary questions a list view actually asks.
LIST_PROJECTION = {'dwp_report_ids': 0, 'topics': 0, 'instructors': 0}

# Paging over an unsorted cursor is not stable -- skip/limit can hand back the same
# document twice or step over one entirely. student_name alone is not enough of a sort
# either, since 17 students share a name with someone; student_key breaks those ties.
# The compound index in build_students.py is what keeps this an index scan.
LIST_SORT = [('student_name', ASCENDING), ('student_key', ASCENDING)]


class Student:

    @staticmethod
    def _collection():
        return db.get_db()['students']

    @staticmethod
    def _page(criteria, limit, offset):
        """(documents for this page, total matching the criteria).

        The total is counted separately rather than inferred from the page, so a caller
        can size a pager on the first request.
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
    def find_all(limit, offset=0):
        return Student._page({}, limit, offset)

    @staticmethod
    def find_by_key(student_key):
        """One student. student_key is account_id + slugified name -- see util.py."""
        return Student._collection().find_one({'student_key': student_key})

    @staticmethod
    def find_by_account(account_id, limit, offset=0):
        """Every student on one household account, i.e. a set of siblings."""
        return Student._page({'account_id': account_id}, limit, offset)

    @staticmethod
    def search(query, limit, offset=0):
        return Student._page(Student._name_criteria(query), limit, offset)

    @staticmethod
    def count_all():
        return Student._collection().count_documents({})
