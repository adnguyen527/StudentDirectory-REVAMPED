from flask import Blueprint, jsonify, request
from models import Student, DigitalWorkoutPlan, Attendance
from bson import json_util
import json

students_bp = Blueprint('students', __name__, url_prefix='/api')

@students_bp.route('/students', methods=['GET'])
def get_students():
    query = request.args.get('query', None)
    students = Student.search(query) if query else Student.find_all()
    return jsonify(json.loads(json_util.dumps(students))), 200

@students_bp.route('/students/<student_id>', methods=['GET'])
def get_student(student_id):
    student = Student.find_by_id(student_id)
    if not student:
        return jsonify({'error': 'Student not found'}), 404

    dwp_reports = DigitalWorkoutPlan.find_by_student_id(student_id)
    attendance_records = Attendance.find_by_student_id(student_id)
    total_hours = sum(r.get('Duration (Minutes)', 0) / 60 for r in attendance_records)

    return jsonify({
        'student': json.loads(json_util.dumps(student)),
        'stats': {
            'total_dwp_reports': len(dwp_reports),
            'total_attendance_records': len(attendance_records),
            'total_hours': round(total_hours, 2)
        },
        'dwp_reports': json.loads(json_util.dumps(dwp_reports)),
        'attendance_records': json.loads(json_util.dumps(attendance_records))
    }), 200

@students_bp.route('/students/search', methods=['GET'])
def search_students():
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    students = Student.search(query)
    return jsonify(json.loads(json_util.dumps(students))), 200
