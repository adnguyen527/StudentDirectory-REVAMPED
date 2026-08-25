import re

from database import db


# dwp_report_ids is internal plumbing -- a list of ObjectId references that grows with
# every session and is only needed when assembling a single student's detail view.
# Excluding it from list results keeps them from ballooning.
LIST_PROJECTION = {'dwp_report_ids': 0}


class Student:

    @staticmethod
    def _collection():
        return db.get_db()['students']

    @staticmethod
    def find_all():
        return list(Student._collection().find({}, LIST_PROJECTION))

    @staticmethod
    def find_by_key(student_key):
        """One student. student_key is account_id + slugified name -- see util.py."""
        return Student._collection().find_one({'student_key': student_key})

    @staticmethod
    def find_by_account(account_id):
        """Every student on one household account, i.e. a set of siblings."""
        return list(Student._collection().find({'account_id': account_id}, LIST_PROJECTION))

    @staticmethod
    def search(query, limit=50):
        # re.escape: the query reaches $regex directly, so an unescaped input can
        # otherwise be crafted into a pathological pattern.
        return list(Student._collection().find(
            {'student_name': {'$regex': re.escape(query), '$options': 'i'}},
            LIST_PROJECTION
        ).limit(limit))

    @staticmethod
    def count_all():
        return Student._collection().count_documents({})
