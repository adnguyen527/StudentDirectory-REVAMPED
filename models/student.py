from database import db


class Student:

    @staticmethod
    def find_all():
        collection = db.get_db()['students']
        return list(collection.find())

    @staticmethod
    def find_by_id(student_id):
        collection = db.get_db()['students']
        return collection.find_one({"accountId": student_id})

    @staticmethod
    def search(query):
        collection = db.get_db()['students']
        return list(collection.find({
            "$or": [
                {"firstName": {"$regex": query, "$options": "i"}},
                {"lastName": {"$regex": query, "$options": "i"}},
                {"studentName": {"$regex": query, "$options": "i"}}
            ]
        }).limit(50))

    @staticmethod
    def count_all():
        collection = db.get_db()['students']
        return collection.count_documents({})
