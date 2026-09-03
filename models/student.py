import re

from pymongo import ASCENDING, DESCENDING

from database import db
from models.filters import center_criteria, range_criteria
from models.sorting import build_order


# Three arrays that grow with every session and are only needed on the detail view.
# Excluding them took the full list response from 1.08 MB to 0.54 MB; the
# total_unique_* counters stay behind to answer what a list view asks.
LIST_PROJECTION = {'dwp_report_ids': 0, 'topics': 0, 'instructors': 0}

# skip/limit over an unsorted cursor can repeat or drop a document. student_name alone
# is not enough either -- 17 students share a name -- so student_key breaks the ties.
# The compound index in build_students.py keeps this an index scan.
LIST_SORT = [('student_name', ASCENDING), ('student_key', ASCENDING)]

# The columns the list page can be sorted by, mapped from the name the URL uses to the
# stored field and the direction that column reads first.
#
# Two of the table's columns are deliberately absent. Center is a multi-select filter
# rather than an order: students carry several centers in one array and there is no single
# value to sort a row by. Account is an opaque 36-character handle shown eight characters
# at a time, so ordering by it arranges households by a string nobody reads -- and the
# one real question about it, "who else is on this account", is `?account_id=` rather
# than a sort.
#
# An allowlist and not a passthrough: `?sort=` reaches a database sort directly, so an
# open one would let a caller order 893 documents by any field in them, indexed or not.
SORTABLE = {
    'name': ('student_name', ASCENDING),
    'sessions': ('total_sessions', DESCENDING),
    'finished': ('total_unique_topics_finished', DESCENDING),
    'on_plan': ('total_topics_on_plan', DESCENDING),
    'last_session': ('last_session_date', DESCENDING),
}

# student_key, not student_name: 17 students share a name, so the name cannot break its
# own ties -- see models/sorting.py.
TIE_BREAK = 'student_key'


# The columns the list page can be filtered by a range, mapped to the stored field and
# the kind of range it takes -- which decides both the URL's suffixes (_min/_max against
# _from/_to) and how the bound is parsed. See routes/filtering.py.
#
# Ranges rather than checkboxes on the counts: "has topics on plan" would match 822 of
# 893 students, which narrows nothing. A minimum is what separates a straggler from a
# problem.
FILTERABLE = {
    'sessions': ('total_sessions', 'number'),
    'finished': ('total_unique_topics_finished', 'number'),
    'on_plan': ('total_topics_on_plan', 'number'),
    'last_session': ('last_session_date', 'date'),
}


def sort_order(sort=None, direction=None):
    return build_order(sort, direction, SORTABLE, TIE_BREAK, LIST_SORT)


class Student:

    @staticmethod
    def _collection():
        return db.get_db()['students']

    @staticmethod
    def _page(criteria, limit, offset, order=None):
        """(documents for this page, total matching the criteria).

        The total is counted separately so a caller can size a pager on the first request.
        """
        collection = Student._collection()
        # A copy: mongomock mutates the projection it is handed -- see models/topic.py.
        documents = list(
            collection.find(criteria, dict(LIST_PROJECTION))
            .sort(order or LIST_SORT)
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
    def find_all(limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        return Student._page(
            {**center_criteria(centers), **range_criteria(ranges, FILTERABLE)},
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def find_by_key(student_key):
        """One student. student_key is account_id + slugified name -- see util.py."""
        return Student._collection().find_one({'student_key': student_key})

    @staticmethod
    def find_by_account(
        account_id, limit, offset=0, centers=None, sort=None, direction=None, ranges=None
    ):
        """Every student on one household account, i.e. a set of siblings."""
        return Student._page(
            {
                'account_id': account_id,
                **center_criteria(centers),
                **range_criteria(ranges, FILTERABLE),
            },
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def search(query, limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        # Different keys, so the criteria merge into one AND -- every filter narrows.
        return Student._page(
            {
                **Student._name_criteria(query),
                **center_criteria(centers),
                **range_criteria(ranges, FILTERABLE),
            },
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def center_names():
        """Distinct center names on this collection, for the filter's checkbox list."""
        return set(Student._collection().distinct('centers.name'))

    @staticmethod
    def count_all():
        return Student._collection().count_documents({})

    @staticmethod
    def latest_session_date():
        """The most recent session anywhere in the data, or None on an empty collection.

        It exists for the date filter, which has to offer "the last 30 days" of the
        *data* rather than of the calendar. The imported data ends 2025-09-17, so a window
        measured back from today matches nobody and reads as a broken filter.

        One indexed field over 893 documents, read through the paging index.
        """
        newest = list(
            Student._collection()
            .find({}, {'last_session_date': 1, '_id': 0})
            .sort([('last_session_date', DESCENDING)])
            .limit(1)
        )
        return newest[0]['last_session_date'] if newest else None
