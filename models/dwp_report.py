from database import db


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
    def find_by_account(account_id):
        """Sessions for every student on a household account."""
        return list(DigitalWorkoutPlan._collection()
                    .find({'account_id': account_id}, PRIVATE_FIELDS)
                    .sort('date', -1))

    @staticmethod
    def count_all():
        return DigitalWorkoutPlan._collection().count_documents({})
