from database import db


class DigitalWorkoutPlan:

    @staticmethod
    def _collection():
        return db.get_db()['dwp_reports']

    @staticmethod
    def find_by_student(account_id, student_name):
        """Sessions for one student.

        Both arguments are required: account_id alone identifies a household, so
        filtering on it would return every sibling's sessions as if they were one
        student's. Served by the account_id index, then filtered on name.
        """
        return list(DigitalWorkoutPlan._collection().find({
            'account_id': account_id,
            'student_name': student_name,
        }).sort('date', -1))

    @staticmethod
    def find_by_account(account_id):
        """Sessions for every student on a household account."""
        return list(DigitalWorkoutPlan._collection()
                    .find({'account_id': account_id})
                    .sort('date', -1))

    @staticmethod
    def count_all():
        return DigitalWorkoutPlan._collection().count_documents({})
