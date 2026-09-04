from flask import Blueprint, jsonify, request

from models import DigitalWorkoutPlan
from models.dwp_report import FILTERABLE, SORTABLE
from routes import filtering, pagination, sorting
from routes.serialization import serialize
from util import make_student_key

reports_bp = Blueprint('reports', __name__, url_prefix='/api')


def _with_student_key(reports):
    """Give each row the identity its Student column links to.

    A report carries account_id and student_name but no student_key -- it is raw source
    data, not a built collection, so nothing has ever added one. Derived through util.py
    rather than assembled here, because that is the file that decides what a student's
    key looks like, and a second spelling of it would link to profiles that do not exist.
    """
    for report in reports:
        report['student_key'] = make_student_key(
            report.get('account_id'), report.get('student_name')
        )
    return reports


@reports_bp.route('/reports', methods=['GET'])
def get_reports():
    """A page of session reports, in the same envelope /api/students returns.

    Newest first, and the order is total -- see LIST_SORT in models/dwp_report.py. This is
    the one list route whose collection has no natural key, so a partial order here would
    repeat and drop rows across page boundaries rather than merely look untidy.

    student_notes is not in the response, by projection rather than by omission here --
    models/dwp_report.py, LIST_PROJECTION, says why.
    """
    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    # A bad sort is a 400 rather than a shrug, as on every other list route.
    sort, direction, error = sorting.parse(request.args, SORTABLE)
    if error:
        return jsonify({'error': error}), 400

    # ?date_from= and ?date_to=, both inclusive.
    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    query = request.args.get('query')
    # Repeatable: several ticked centers are a union. A report can name more than one
    # center -- the source writes them semicolon-separated -- so this union is not a
    # partition, and the per-center counts do not have to sum to the total.
    centers = request.args.getlist('center')

    if query:
        reports, total = DigitalWorkoutPlan.search(
            query, limit, offset, centers, sort, direction, ranges
        )
    else:
        reports, total = DigitalWorkoutPlan.find_all(
            limit, offset, centers, sort, direction, ranges
        )

    return jsonify(
        pagination.envelope('reports', _with_student_key(reports), total, limit, offset)
    ), 200


@reports_bp.route('/reports/<report_id>', methods=['GET'])
def get_report(report_id):
    """One report, whole.

    Unlike the list, this serves student_notes -- see DETAIL_PROJECTION in
    models/dwp_report.py for why the two differ.

    Wrapped in an object rather than returned bare, as /api/topics/<id> is, so the fields
    this page grows later do not move what is already here. A malformed id is a 404 rather
    than a 500; find_by_id absorbs that.
    """
    report = DigitalWorkoutPlan.find_by_id(report_id)
    if not report:
        return jsonify({'error': 'Report not found'}), 404

    return jsonify({'report': serialize(_with_student_key([report])[0])}), 200
