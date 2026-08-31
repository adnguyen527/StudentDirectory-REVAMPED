from datetime import datetime

from flask import Blueprint, jsonify, request

from models import Attendance, Student, DigitalWorkoutPlan
from routes import pagination
from routes.serialization import serialize

students_bp = Blueprint('students', __name__, url_prefix='/api')

DATE_FORMAT = '%Y-%m-%d'


def _parse_period(args):
    """(start, end, error) from ?start=&end=, both YYYY-MM-DD and both required.

    No default period: "this month" returns nothing whenever the imported data lags the
    calendar, which reads as a broken endpoint rather than an empty month.
    """
    raw_start, raw_end = args.get('start'), args.get('end')
    if not raw_start or not raw_end:
        return None, None, 'start and end are required, as YYYY-MM-DD'

    try:
        start = datetime.strptime(raw_start, DATE_FORMAT)
        end = datetime.strptime(raw_end, DATE_FORMAT)
    except ValueError:
        return None, None, 'start and end must be YYYY-MM-DD dates'

    if start > end:
        return None, None, 'start must not be after end'
    return start, end, None


@students_bp.route('/students', methods=['GET'])
def get_students():
    """A page of students; ?account_id= takes precedence over ?query=.

    Paged by default, siblings included, so every caller reads one response shape.
    """
    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    account_id = request.args.get('account_id')
    query = request.args.get('query')

    if account_id:
        students, total = Student.find_by_account(account_id, limit, offset)
    elif query:
        students, total = Student.search(query, limit, offset)
    else:
        students, total = Student.find_all(limit, offset)

    return jsonify(
        pagination.envelope('students', students, total, limit, offset)
    ), 200


@students_bp.route('/students/search', methods=['GET'])
def search_students():
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    students, total = Student.search(query, limit, offset)

    return jsonify(
        pagination.envelope('students', students, total, limit, offset)
    ), 200


@students_bp.route('/students/<student_key>/attendance', methods=['GET'])
def get_student_attendance(student_key):
    """Sessions one student attended in a period, for a manager talking to a parent.

    Consumption, not balance: how many sessions were used. How many were purchased lives
    in billing, which this system does not hold.
    """
    student = Student.find_by_key(student_key)
    if not student:
        return jsonify({'error': 'Student not found'}), 404

    start, end, error = _parse_period(request.args)
    if error:
        return jsonify({'error': error}), 400

    summary = Attendance.period_summary(student_key, start, end)

    return jsonify({
        'student': {
            'student_key': student['student_key'],
            'student_name': student['student_name'],
            'account_id': student['account_id'],
        },
        'period': {
            'start': start.strftime(DATE_FORMAT),
            'end': end.strftime(DATE_FORMAT),
        },
        'totals': summary['totals'],
        'by_month': summary['by_month'],
        'visits': serialize(summary['visits']),
    }), 200


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
        'student': serialize(student),
        'stats': {
            'total_dwp_reports': len(dwp_reports),
        },
        'dwp_reports': serialize(dwp_reports),
    }), 200
