import re

from database import db


# days_taught and students are the two arrays that grow with the dataset -- 272 dates and
# a 304-student roster at the top end of the current data. Both are only read on the
# detail view, so list results project them out and lean on the counts stored beside
# them, total_days_taught and unique_students, which say the same thing in one number.
LIST_PROJECTION = {'days_taught': 0, 'students': 0}


class Instructor:
    """Aggregated per-instructor profiles -- see ingestion/build_instructors.py.

    Keyed on instructor_name, because a name is all the source data carries. Two people
    sharing a name merge into one document and nothing here can tell them apart.
    """

    @staticmethod
    def _collection():
        return db.get_db()['instructors']

    @staticmethod
    def find_all():
        return list(Instructor._collection().find({}, LIST_PROJECTION))

    @staticmethod
    def find_by_name(instructor_name):
        """One instructor, roster and days included -- exact match on the unique index."""
        return Instructor._collection().find_one({'instructor_name': instructor_name})

    @staticmethod
    def search(query, limit=50):
        # re.escape for the same reason as Student.search: the query reaches $regex
        # directly, so an unescaped input can be crafted into a pathological pattern.
        return list(Instructor._collection().find(
            {'instructor_name': {'$regex': re.escape(query), '$options': 'i'}},
            LIST_PROJECTION
        ).limit(limit))

    @staticmethod
    def count_all():
        return Instructor._collection().count_documents({})
