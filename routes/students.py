from flask import Blueprint, jsonify, request
from models import Student, DigitalWorkoutPlan
from bson import json_util
import json

students_bp = Blueprint('students', __name__, url_prefix='/api')


def _serialize(value):
    """BSON (ObjectId, datetime) -> JSON-safe structures."""
    return json.loads(json_util.dumps(value))


@students_bp.route('/students', methods=['GET'])
def get_students():
    account_id = request.args.get('account_id')
    query = request.args.get('query')

    if account_id:
        students = Student.find_by_account(account_id)
    elif query:
        students = Student.search(query)
    else:
        students = Student.find_all()

    return jsonify(_serialize(students)), 200


@students_bp.route('/students/search', methods=['GET'])
def search_students():
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    return jsonify(_serialize(Student.search(query))), 200


@students_bp.route('/students/<student_key>', methods=['GET'])
def get_student(student_key):
    student = Student.find_by_key(student_key)
    if not student:
        return jsonify({'error': 'Student not found'}), 404

    # Scoped to this student, not the household -- siblings share account_id.
    dwp_reports = DigitalWorkoutPlan.find_by_student(
        student['account_id'], student['student_name']
    )

    return jsonify({
        'student': _serialize(student),
        'stats': {
            'total_dwp_reports': len(dwp_reports),
        },
        'dwp_reports': _serialize(dwp_reports),
    }), 200
