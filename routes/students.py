from datetime import datetime

from flask import Blueprint, jsonify, request

from models import Attendance, Student, DigitalWorkoutPlan
from models.student import FILTERABLE, SORTABLE
from routes import filtering, pagination, sorting
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

    # A bad sort is a 400 rather than a shrug: unlike an unknown center, there is no
    # correct list to serve for a column that does not exist.
    sort, direction, error = sorting.parse(request.args, SORTABLE)
    if error:
        return jsonify({'error': error}), 400

    # The column ranges: ?sessions_min=, ?last_session_from=, and their pairs. A bad
    # number or a backwards range is a 400, in the same voice as a bad limit.
    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    account_id = request.args.get('account_id')
    query = request.args.get('query')
    # Repeatable: the center filter is multi-select, and several names are a union.
    # Combines with account_id and query rather than replacing either.
    centers = request.args.getlist('center')

    if account_id:
        students, total = Student.find_by_account(
            account_id, limit, offset, centers, sort, direction, ranges
        )
    elif query:
        students, total = Student.search(
            query, limit, offset, centers, sort, direction, ranges
        )
    else:
        students, total = Student.find_all(limit, offset, centers, sort, direction, ranges)

    return jsonify(
        pagination.envelope('students', students, total, limit, offset)
    ), 200


@students_bp.route('/students/distribution', methods=['GET'])
def get_student_distribution():
    """How the students this list would show are spread across centers.

    Backs the bar chart above the list, and takes the list's own filters -- ?query=,
    ?center= and the FILTERABLE ranges, spelled exactly as /api/students spells them -- so
    the chart and the table are one population counted once. That is why this is not a
    slice of /api/centers/metrics, whose figures come from `dwp_reports` and answer what
    happened at a center in a period rather than how these rows divide up.

    Unpaged and unsortable: the row count is bounded by the number of centers, and the
    order is the name order /api/centers already serves its checkboxes in.

    ?account_id= is deliberately not accepted. The list offers it to show one household's
    siblings, and a bar chart over two children is noise.

    A static rule beside /api/students/<student_key>, which Werkzeug ranks above the
    converter rule regardless of registration order -- as /api/students/search already
    does. Do not "fix" the ordering of these three.
    """
    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    centers = request.args.getlist('center')

    return jsonify({
        # Echoed as /api/centers/metrics echoes its selection: the response outlives the
        # request that asked for it, in a cache or a screenshot.
        'centers': sorted({name for name in centers if name}),
        **Student.distribution(request.args.get('query'), centers, ranges),
    }), 200


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
