from database import db


class Attendance:

    @staticmethod
    def find_all():
        collection = db.get_db()['attendance_reports']
        return list(collection.find())

    @staticmethod
    def find_by_student_id(student_id):
        collection = db.get_db()['attendance_reports']
        return list(collection.find({"Account Id": student_id}))

    @staticmethod
    def count_all():
        collection = db.get_db()['attendance_reports']
        return collection.count_documents({})
