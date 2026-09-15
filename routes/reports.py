from flask import Blueprint, jsonify, request

from models import DigitalWorkoutPlan, quality
from models.dwp_report import FILTERABLE, SORTABLE
from models.trends import series
from routes import filtering, pagination, sorting, trends
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
    the one list route whose collection has no *unique* key, so a partial order here would
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
    # Repeatable for the same reason, and a co-taught session matches on either name. It
    # exists here so the report-volume chart above this table can be narrowed to one
    # instructor and the table can follow -- a filter the chart offers and the list could
    # not honour would be exactly the divergence these two are built to avoid.
    instructors = request.args.getlist('instructor')

    if query:
        reports, total = DigitalWorkoutPlan.search(
            query, limit, offset, centers, sort, direction, ranges, instructors
        )
    else:
        reports, total = DigitalWorkoutPlan.find_all(
            limit, offset, centers, sort, direction, ranges, instructors
        )

    return jsonify(
        pagination.envelope('reports', _with_student_key(reports), total, limit, offset)
    ), 200


@reports_bp.route('/reports/trends', methods=['GET'])
def get_report_trends():
    """Sessions over time, for the report-volume chart above the reports list.

    Takes the list's own filters, spelled the same way -- ?query=, ?center=, ?instructor=,
    ?date_from= and ?date_to= -- so the bars and the table are one query drawn twice. Adds
    ?interval=day|week|month, which the chart widens as the range grows.

    Counted from `dwp_reports`, where a session is one row: summing the built per-instructor
    aggregates would count a co-taught session twice. models/trends.py has the figures.

    Buckets are contiguous and include the empty ones, so a quiet week reads as a zero
    rather than as a hole. The edge buckets may be `partial` -- the range is used exactly as
    asked rather than snapped outward to bucket boundaries, because this chart sits above a
    table filtered by those same dates and must not count sessions that table excludes.

    Sessions only. Pages and distinct students are computed by the same pass and dropped
    here, because this chart draws volume; /api/home/trends and /api/instructors/trends are
    where they have a reader.

    A static rule beside /api/reports/<report_id>, which Werkzeug ranks above the converter
    rule regardless of registration order.
    """
    interval, start, end, error = trends.parse(
        request.args, DigitalWorkoutPlan.latest_session_date()
    )
    if error:
        return jsonify({'error': error}), 400

    query = request.args.get('query')
    centers = request.args.getlist('center')
    instructors = request.args.getlist('instructor')

    buckets = [] if start is None else series(
        # The resolved window is handed back through the same range_criteria the list uses,
        # so a default window and a caller's own bounds ride one code path and "inclusive
        # midnight to midnight" has a single spelling.
        DigitalWorkoutPlan.criteria(query, centers, instructors, {'date': (start, end)}),
        start, end, interval,
    )

    return jsonify(trends.envelope(
        interval, start, end, buckets, ('sessions',),
        centers=centers, instructors=instructors,
    )), 200


@reports_bp.route('/reports/quality', methods=['GET'])
def get_report_quality():
    """What is missing or contradictory in the report data right now.

    Backs the monitoring cards. Takes ?center= and the ?date_from=/?date_to= pair, so a
    manager can scope it to their own centers, and answers counts only -- every row behind
    these numbers is about a named child, so linking a card to the reports it counts is the
    reports list's job through its own filters, not this endpoint's.

    Under /api/reports rather than a bare /api/quality: every check here is a question about
    `dwp_reports`, and student- and instructor-level checks will want that name later.

    ⚠️ **Current state, not an import audit.** These say what is wrong with the collection
    today, which is what can be acted on. What a particular import run did -- which rows it
    skipped, from which file, when -- is not recorded anywhere and is not recoverable here;
    that is the `import_runs` collection on the TODO. `ambiguous_keys` is the one that looks
    like history and is not: the colliding documents are still in the collection, so the
    condition is findable even though the event that created it was never written down.
    """
    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    centers = request.args.getlist('center')

    return jsonify({
        'centers': sorted({name for name in centers if name}),
        **serialize(quality.summary(
            DigitalWorkoutPlan.criteria(None, centers, None, ranges)
        )),
    }), 200


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
