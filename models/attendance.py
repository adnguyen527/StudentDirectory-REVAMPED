from database import db


# dwp_report_ids links each day back to the sessions it was built from. It is only
# needed when drilling into one day, so list results project it out.
LIST_PROJECTION = {'dwp_report_ids': 0}


class Attendance:
    """One document per student per day attended -- see ingestion/build_attendance.py.

    A day is not a session: 70 student-days in the current data cover more than one
    session, so counting sessions and counting attendance give different answers.
    """

    @staticmethod
    def _collection():
        return db.get_db()['attendance_reports']

    @staticmethod
    def find_by_student(student_key, limit=None):
        """Days attended by one student, newest first."""
        cursor = (Attendance._collection()
                  .find({'student_key': student_key}, LIST_PROJECTION)
                  .sort('date', -1))
        return list(cursor.limit(limit) if limit else cursor)

    @staticmethod
    def find_by_account(account_id):
        """Days attended by everyone on one household account, newest first."""
        return list(Attendance._collection()
                    .find({'account_id': account_id}, LIST_PROJECTION)
                    .sort('date', -1))

    @staticmethod
    def find_by_date_range(start, end, student_key=None):
        """Days in [start, end]. Both bounds are inclusive datetimes.

        Served by the date index, or by the compound key when scoped to a student.
        """
        query = {'date': {'$gte': start, '$lte': end}}
        if student_key:
            query['student_key'] = student_key
        return list(Attendance._collection()
                    .find(query, LIST_PROJECTION)
                    .sort('date', -1))

    @staticmethod
    def count_all():
        return Attendance._collection().count_documents({})

    @staticmethod
    def count_by_student(student_key):
        return Attendance._collection().count_documents({'student_key': student_key})
