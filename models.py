from bson import ObjectId
from database import db

class DigitalWorkoutPlan:
    """Model for Digital Workout Plan reports"""

    def __init__(self, data=None):
        self.data = data or {}

    @staticmethod
    def find_all():
        """Get all DWP reports"""
        try:
            database = db.get_db()
            collection = database['dwp_reports']
            reports = list(collection.find())
            return reports
        except Exception as e:
            print(f"Error fetching DWP reports: {e}")
            return []

    @staticmethod
    def find_by_student_id(student_id):
        """Get DWP reports for a specific student"""
        try:
            database = db.get_db()
            collection = database['dwp_reports']
            reports = list(collection.find({"Account Id": student_id}))
            return reports
        except Exception as e:
            print(f"Error fetching DWP reports for student {student_id}: {e}")
            return []

    @staticmethod
    def count_all():
        """Get total count of DWP reports"""
        try:
            database = db.get_db()
            collection = database['dwp_reports']
            return collection.count_documents({})
        except Exception as e:
            print(f"Error counting DWP reports: {e}")
            return 0

class Attendance:
    """Model for Attendance records"""

    def __init__(self, data=None):
        self.data = data or {}

    @staticmethod
    def find_all():
        """Get all attendance records"""
        try:
            database = db.get_db()
            collection = database['attendance_reports']
            records = list(collection.find())
            return records
        except Exception as e:
            print(f"Error fetching attendance records: {e}")
            return []

    @staticmethod
    def find_by_student_id(student_id):
        """Get attendance records for a specific student"""
        try:
            database = db.get_db()
            collection = database['attendance_reports']
            records = list(collection.find({"Account Id": student_id}))
            return records
        except Exception as e:
            print(f"Error fetching attendance for student {student_id}: {e}")
            return []

    @staticmethod
    def count_all():
        """Get total count of attendance records"""
        try:
            database = db.get_db()
            collection = database['attendance_reports']
            return collection.count_documents({})
        except Exception as e:
            print(f"Error counting attendance records: {e}")
            return 0

class Student:
    """Model for Student data"""

    def __init__(self, data=None):
        self.data = data or {}

    @staticmethod
    def find_all():
        """Get all students"""
        try:
            database = db.get_db()
            collection = database['students']
            students = list(collection.find())
            return students
        except Exception as e:
            print(f"Error fetching students: {e}")
            return []

    @staticmethod
    def find_by_id(student_id):
        """Get a specific student by ID"""
        try:
            database = db.get_db()
            collection = database['students']
            student = collection.find_one({"accountId": student_id})
            return student
        except Exception as e:
            print(f"Error fetching student {student_id}: {e}")
            return None

    @staticmethod
    def search(query):
        """Search students by name"""
        try:
            database = db.get_db()
            collection = database['students']
            students = list(collection.find({
                "$or": [
                    {"firstName": {"$regex": query, "$options": "i"}},
                    {"lastName": {"$regex": query, "$options": "i"}},
                    {"studentName": {"$regex": query, "$options": "i"}}
                ]
            }).limit(50))
            return students
        except Exception as e:
            print(f"Error searching students: {e}")
            return []

    @staticmethod
    def count_all():
        """Get total count of students"""
        try:
            database = db.get_db()
            collection = database['students']
            return collection.count_documents({})
        except Exception as e:
            print(f"Error counting students: {e}")
            return 0
