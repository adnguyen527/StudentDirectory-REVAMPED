from flask import Blueprint, jsonify, request
from models import Student, Instructor, DigitalWorkoutPlan, Attendance, Center
from models.trends import series
from routes import trends
from routes.serialization import serialize

metrics_bp = Blueprint('metrics', __name__, url_prefix='/api')

@metrics_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Backend is running'}), 200

@metrics_bp.route('/centers', methods=['GET'])
def get_centers():
    """Every center name the two list routes can be filtered by.

    Served rather than hard-coded in the frontend: four names written into a component
    would be silently wrong the day a fifth center opens. The union of what the two
    filterable collections actually hold is exactly the set of values that can match
    something, and both are small enough (893 + 103) to read distinct values from.
    """
    names = Student.center_names() | Instructor.center_names()
    # Sorted so the checkboxes hold still between requests; a set has no order.
    return jsonify({'centers': sorted(names)}), 200


@metrics_bp.route('/centers/metrics', methods=['GET'])
def get_center_metrics():
    """What one manager's centers add up to, for the center dashboard's stat tiles.

    ?center= is repeatable and the several names are a union, as on every list route --
    the page offers a combined view of the centers a manager can reach rather than one at
    a time. None given means every center, which is the same query `center_criteria`
    already builds for an absent filter.

    An unrecognised name answers zeroes with a 200. "Nothing happened at Xyz" is a correct
    answer to a filter, where `sort=bogus` has none -- see models/filters.py. Do not turn
    this into a 400.

    The figures come from `dwp_reports`, not from summing the built per-center aggregates.
    models/center.py says why: co-taught sessions credit each instructor the full page
    count, so instructor pages overshoot a center total by about ten percent.

    Not wrapped in a try/except that reports str(e). get_metrics below does, and it is the
    only route here that does; a database fault should reach the client as a 500 with
    nothing in it about the cluster.
    """
    centers = request.args.getlist('center')
    totals = Center.summary(centers)

    return jsonify({
        # Echoed so the client can tell which selection produced these figures -- the
        # response outlives the request that asked for it in a cache or a screenshot.
        # Blank values are dropped here exactly as center_criteria drops them.
        'centers': sorted({name for name in centers if name}),
        'totals': serialize(totals),
    }), 200


@metrics_bp.route('/home/trends', methods=['GET'])
def get_home_trends():
    """Monthly activity across the program, for the Home page's trend charts.

    Sessions, distinct students, pages completed and unfinalized reports per month. Monthly
    by default where the other two trend routes are daily, because this is the view a
    manager opens on -- and `default_buckets` is per interval, so asking for months gets a
    year of them rather than a month of days. Widening it from one month to three is a
    `?date_from=`, with no change to the response.

    ⚠️ `students` is distinct *within* a month and does NOT sum across months. Someone who
    came in February and in March is counted in both, which is what a trend line means and
    is wrong for anyone totalling the column.

    No `finalized` count: it is `sessions - unfinalized`, and the unfinalized side is the
    actionable one -- the reports a manager can still chase.

    Named for the page rather than for a resource, which the rest of this API does not do.
    Kept because the Home page is the only caller and the README calls it home activity;
    worth renaming if a second reader appears.
    """
    interval, start, end, error = trends.parse(
        request.args, DigitalWorkoutPlan.latest_session_date(), default_interval='month'
    )
    if error:
        return jsonify({'error': error}), 400

    centers = request.args.getlist('center')

    buckets = [] if start is None else series(
        DigitalWorkoutPlan.criteria(None, centers, None, {'date': (start, end)}),
        start, end, interval,
    )

    return jsonify(trends.envelope(
        interval, start, end, buckets,
        ('sessions', 'students', 'pages_completed', 'unfinalized'),
        centers=centers,
    )), 200


@metrics_bp.route('/metrics', methods=['GET'])
def get_metrics():
    try:
        total_students = Student.count_all()
        total_instructors = Instructor.count_all()
        total_dwp_reports = DigitalWorkoutPlan.count_all()
        total_attendance_records = Attendance.count_all()

        # The anchor for the date filter's presets: "the last 30 days" has to mean the
        # last 30 days of the data, which ends well before today.
        latest_session = Student.latest_session_date()

        return jsonify({
            'latest_session_date': serialize(latest_session) if latest_session else None,
            'total_students': total_students,
            'total_instructors': total_instructors,
            'total_dwp_reports': total_dwp_reports,
            'total_attendance_records': total_attendance_records,
            'avg_dwp_per_student': round(total_dwp_reports / total_students, 2) if total_students else 0,
            'avg_attendance_per_student': round(total_attendance_records / total_students, 2) if total_students else 0
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
