from database import db


# Fields that never leave the server.
#
# row_hash and lead_id are internal plumbing -- an idempotency fingerprint and a household
# id the API already exposes as account_id. internal_notes and the director's notes are
# staff-to-staff commentary about a named child, which no client of this API needs in
# order to render a student's work.
#
# The source renamed two note columns partway through the dataset, so both spellings are
# excluded: notes_for_center_director survives on 3,655 older rows and would otherwise
# carry 23 populated notes straight past a filter written for the newer name only.
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

        Both arguments are required: account_id alone identifies a household, so
        filtering on it would return every sibling's sessions as if they were one
        student's. Served by the account_id index, then filtered on name.
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
