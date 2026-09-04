import re

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ASCENDING, DESCENDING

from database import db
from models.filters import center_criteria, range_criteria
from models.sorting import build_order


# Fields that never leave the server: internal plumbing (row_hash, lead_id) and
# staff-to-staff commentary about a named child.
#
# BOTH spellings of the director's notes are excluded -- the source renamed the column
# partway through, and 3,655 older rows still carry the old one with 23 populated notes.
PRIVATE_FIELDS = {
    'row_hash': 0,
    'lead_id': 0,
    'internal_notes': 0,
    'notes_from_center_director': 0,
    'notes_for_center_director': 0,
}

# PRIVATE_FIELDS plus student_notes. The notes are shown on a student's own profile, where
# you are reading about one child; this route is the same 3,594 comments about named
# children behind a date filter and a Next button, which is a different act. Withheld here
# rather than case-by-case in the UI, so the list cannot grow a way to show them by
# accident.
LIST_PROJECTION = {**PRIVATE_FIELDS, 'student_notes': 0}

# ⚠️ The detail view keeps student_notes, and the difference between these two constants is
# exactly that one field. It is deliberate, not an oversight to tidy up: one report opened
# on purpose is the same act as reading it on the student's own profile, which has always
# shown them. Paging through 3,594 of them behind a date filter is not.
DETAIL_PROJECTION = dict(PRIVATE_FIELDS)

# Newest first: a session list is read from today backwards.
#
# ⚠️ date alone is NOT a total order here. 29,382 reports over 309 days is a median of 85 a
# day and 192 on the busiest, so nearly every page boundary lands inside a tie, and
# skip/limit over a partial order repeats a document on one page and drops it from the
# next. _id is the only field on this collection guaranteed unique -- there is no natural
# key, which is why ingestion carries row_hash at all.
LIST_SORT = [('date', DESCENDING), ('_id', ASCENDING)]

TIE_BREAK = '_id'

# The columns the list page can be sorted by -- as Student.SORTABLE.
#
# Deliberately short. Pages and mathlete score are the other two columns worth ordering by,
# and both are null on the 1,068 reports nobody finalized; Mongo sorts null below every
# number, so an ascending Pages sort would open with the rows that have no pages at all.
# Fixing that needs the computed-key aggregate in Topic._page, and duplicating that branch
# is not worth doing until someone asks for the column.
SORTABLE = {
    'date': ('date', DESCENDING),
    'student': ('student_name', ASCENDING),
}

# As Student.FILTERABLE. The date is the only bounded column: the center filter is a
# multi-select rather than a range, and the numeric columns are not sortable here either.
FILTERABLE = {'date': ('date', 'date')}

# The centers on a report are a bare list of strings, not the [{name, sessions}] students
# and instructors carry -- see ingestion/import_reports.py, parse_center.
CENTER_FIELD = 'centers'


def sort_order(sort=None, direction=None):
    return build_order(sort, direction, SORTABLE, TIE_BREAK, LIST_SORT)


class DigitalWorkoutPlan:

    @staticmethod
    def _collection():
        return db.get_db()['dwp_reports']

    @staticmethod
    def find_by_student(account_id, student_name):
        """Sessions for one student.

        Both arguments are required -- account_id alone is a household, and would return
        every sibling's sessions as if they were one student's.
        """
        return list(DigitalWorkoutPlan._collection().find({
            'account_id': account_id,
            'student_name': student_name,
        }, PRIVATE_FIELDS).sort('date', -1))

    @staticmethod
    def find_by_id(report_id):
        """One report, or None -- including when the id is not an ObjectId at all.

        dwp_reports has no natural key, so _id is the handle the URL carries. A mistyped
        one reaches ObjectId() as arbitrary text and raises InvalidId; swallowing that
        here is what makes /api/reports/not-an-oid a 404 rather than a 500, which is the
        honest answer -- there is no such report either way.
        """
        try:
            key = ObjectId(report_id)
        except (InvalidId, TypeError):
            return None
        return DigitalWorkoutPlan._collection().find_one({'_id': key}, dict(DETAIL_PROJECTION))

    @staticmethod
    def find_by_account(account_id):
        """Sessions for every student on a household account."""
        return list(DigitalWorkoutPlan._collection()
                    .find({'account_id': account_id}, dict(PRIVATE_FIELDS))
                    .sort('date', -1))

    @staticmethod
    def _page(criteria, limit, offset, order=None):
        """(documents for this page, total matching the criteria) -- as Student._page.

        The total is counted separately so a caller can size a pager on the first request.
        """
        collection = DigitalWorkoutPlan._collection()
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
        """Substring match on the student the session was for.

        The student, not the instructor: this list is read student-first, and the
        instructor is a column rather than the thing you arrive looking for.
        """
        # re.escape: the query reaches $regex directly -- see Student._name_criteria.
        return {'student_name': {'$regex': re.escape(query), '$options': 'i'}}

    @staticmethod
    def find_all(limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        return DigitalWorkoutPlan._page(
            {
                **center_criteria(centers, CENTER_FIELD),
                **range_criteria(ranges, FILTERABLE),
            },
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def search(query, limit, offset=0, centers=None, sort=None, direction=None, ranges=None):
        # Different keys, so the criteria merge into one AND -- every filter narrows.
        return DigitalWorkoutPlan._page(
            {
                **DigitalWorkoutPlan._name_criteria(query),
                **center_criteria(centers, CENTER_FIELD),
                **range_criteria(ranges, FILTERABLE),
            },
            limit,
            offset,
            sort_order(sort, direction),
        )

    @staticmethod
    def count_all():
        return DigitalWorkoutPlan._collection().count_documents({})
