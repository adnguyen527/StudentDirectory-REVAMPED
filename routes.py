from flask import Blueprint, jsonify, request
from models import Student, DigitalWorkoutPlan, Attendance
from bson import json_util
import json

api = Blueprint('api', __name__, url_prefix='/api')

@api.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint/check if backend running"""
    return jsonify({'status': 'ok', 'message': 'Backend is running'}), 200

@api.route('/students', methods=['GET'])
def get_students():
    """Get all students or search students"""
    query = request.args.get('query', None)

    if query:
        students = Student.search(query)
    else:
        students = Student.find_all()

    # Convert ObjectId to string for JSON serialization
    result = json.loads(json_util.dumps(students))
    return jsonify(result), 200

@api.route('/students/<student_id>', methods=['GET'])
def get_student(student_id):
    """Get a specific student with their DWP and attendance records"""
    student = Student.find_by_id(student_id)

    if not student:
        return jsonify({'error': 'Student not found'}), 404

    # Get DWP reports for this student
    dwp_reports = DigitalWorkoutPlan.find_by_student_id(student_id)

    # Get attendance records for this student
    attendance_records = Attendance.find_by_student_id(student_id)

    # Calculate stats
    total_dwp_reports = len(dwp_reports)
    total_attendance_records = len(attendance_records)
    total_hours = sum([record.get('Duration (Minutes)', 0) / 60 for record in attendance_records]) if attendance_records else 0

    # Build response
    student_data = json.loads(json_util.dumps(student))
    response = {
        'student': student_data,
        'stats': {
            'total_dwp_reports': total_dwp_reports,
            'total_attendance_records': total_attendance_records,
            'total_hours': round(total_hours, 2)
        },
        'dwp_reports': json.loads(json_util.dumps(dwp_reports)),
        'attendance_records': json.loads(json_util.dumps(attendance_records))
    }

    return jsonify(response), 200

@api.route('/metrics', methods=['GET'])
def get_metrics():
    """Get overall dashboard metrics"""
    try:
        total_students = Student.count_all()
        total_dwp_reports = DigitalWorkoutPlan.count_all()
        total_attendance_records = Attendance.count_all()

        # Get all students for additional calculations
        all_students = Student.find_all()

        # Calculate average DWP reports per student
        avg_dwp_per_student = total_dwp_reports / total_students if total_students > 0 else 0

        # Calculate average attendance per student
        avg_attendance_per_student = total_attendance_records / total_students if total_students > 0 else 0

        metrics = {
            'total_students': total_students,
            'total_dwp_reports': total_dwp_reports,
            'total_attendance_records': total_attendance_records,
            'avg_dwp_per_student': round(avg_dwp_per_student, 2),
            'avg_attendance_per_student': round(avg_attendance_per_student, 2)
        }

        return jsonify(metrics), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@api.route('/students/search', methods=['GET'])
def search_students():
    """Search students by name or ID"""
    query = request.args.get('q', '')

    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    students = Student.search(query)
    result = json.loads(json_util.dumps(students))

    return jsonify(result), 200
