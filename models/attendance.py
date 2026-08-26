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
    def period_summary(student_key, start, end):
        """One student's attendance across [start, end], oldest first.

        Counts SESSIONS, not days. Families prepay a set number of sessions, so a day
        with two sessions draws down two -- 70 student-days in the current data carry
        more than one. `days` is reported alongside because they are not the same number
        and a reader will want to know which they are looking at.

        Unfinalized sessions count. The student attended; whether the instructor ever
        completed the report is a staffing matter, not a reason to hand the family back a
        session.

        Both bounds are inclusive. `date` is stored at midnight, so an end of 2025-06-30
        includes everything on the 30th.
        """
        visits = list(Attendance._collection()
                      .find({'student_key': student_key,
                             'date': {'$gte': start, '$lte': end}},
                            LIST_PROJECTION)
                      .sort('date', 1))

        by_month = {}
        for visit in visits:
            month = visit['date'].strftime('%Y-%m')
            bucket = by_month.setdefault(month, {'month': month, 'sessions': 0, 'days': 0})
            bucket['sessions'] += visit.get('sessions') or 0
            bucket['days'] += 1

        return {
            'totals': {
                'sessions': sum(v.get('sessions') or 0 for v in visits),
                'days': len(visits),
            },
            # A list, not a dict: JSON object key order is not something a client should
            # have to trust, and the frontend wants to iterate these in order.
            'by_month': [by_month[m] for m in sorted(by_month)],
            'visits': visits,
        }

    @staticmethod
    def count_all():
        return Attendance._collection().count_documents({})

    @staticmethod
    def count_by_student(student_key):
        return Attendance._collection().count_documents({'student_key': student_key})
