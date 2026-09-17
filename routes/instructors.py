from flask import Blueprint, jsonify, request

from models import DigitalWorkoutPlan, Instructor
from models.instructor import FILTERABLE, SORTABLE
from models.trends import series
from routes import filtering, pagination, sorting, trends
from routes.serialization import serialize

instructors_bp = Blueprint('instructors', __name__, url_prefix='/api')


@instructors_bp.route('/instructors', methods=['GET'])
def get_instructors():
    """A page of instructors, in the same envelope /api/students returns.

    103 documents need no paging today; they share the shape so the frontend learns one
    convention and the roster can grow without the route changing.
    """
    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    # Students and Days sort too, though they are derived rather than stored -- see
    # Instructor._page for what that costs.
    sort, direction, error = sorting.parse(request.args, SORTABLE)
    if error:
        return jsonify({'error': error}), 400

    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    query = request.args.get('query')
    # Repeatable, as on /api/students. On instructors the union is not a partition: 11 of
    # 103 work at more than one center, so ticking two returns fewer than the two counts
    # added together.
    centers = request.args.getlist('center')

    if query:
        instructors, total = Instructor.search(
            query, limit, offset, centers, sort, direction, ranges
        )
    else:
        instructors, total = Instructor.find_all(
            limit, offset, centers, sort, direction, ranges
        )

    return jsonify(
        pagination.envelope('instructors', instructors, total, limit, offset)
    ), 200


@instructors_bp.route('/instructors/trends', methods=['GET'])
def get_instructor_trends():
    """Workload over time -- sessions, distinct students and pages per bucket.

    ?instructor= is repeatable and narrows to those people's sessions; ?center= narrows to
    where the sessions happened. Neither given is the whole program, as on every list route.

    Read from `dwp_reports` rather than the `instructors` aggregate, which is all-time and
    so cannot answer a period at all.

    ⚠️ **Pages are credited, not split.** A co-taught session's pages count in full for each
    instructor on it -- 2,563 of 29,382 sessions have more than one. That is the right answer
    to "how much work happened in sessions I ran", and it means two single-instructor
    requests added together overshoot the real total: across the program the same arithmetic
    gives 168,623 pages against the 153,360 recorded. Label the column, do not sum it.

    ⚠️ `students` is distinct within a bucket and does not sum across buckets.

    One instructor over time, or a filtered selection as one line. Comparing several
    instructors as separate series is a different response shape and is not this endpoint.
    """
    interval, start, end, error = trends.parse(
        request.args, DigitalWorkoutPlan.latest_session_date()
    )
    if error:
        return jsonify({'error': error}), 400

    centers = request.args.getlist('center')
    instructors = request.args.getlist('instructor')

    buckets = [] if start is None else series(
        DigitalWorkoutPlan.criteria(None, centers, instructors, {'date': (start, end)}),
        start, end, interval,
    )

    return jsonify(trends.envelope(
        interval, start, end, buckets, ('sessions', 'students', 'pages_completed'),
        centers=centers, instructors=instructors,
    )), 200


@instructors_bp.route('/instructors/distribution', methods=['GET'])
def get_instructor_distribution():
    """How the instructors this list would show are spread across centers.

    The same collection and the same filters as /api/instructors, so the bars reconcile
    with the table beneath them -- see /api/students/distribution, which says why this is
    not a slice of /api/centers/metrics.

    ⚠️ **The bars do not sum to `total`.** 11 of 103 instructors work at more than one
    center and appear under each: one person, two bars. `counted` is the sum of the bars
    and `total` is the roster, and the page has to label the difference rather than let it
    read as an error. On /api/students/distribution the two are equal, because a student
    belongs to exactly one center -- see models/filters.py.
    """
    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    centers = request.args.getlist('center')

    return jsonify({
        'centers': sorted({name for name in centers if name}),
        **Instructor.distribution(request.args.get('query'), centers, ranges),
    }), 200


@instructors_bp.route('/instructors/search', methods=['GET'])
def search_instructors():
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    instructors, total = Instructor.search(query, limit, offset)

    return jsonify(
        pagination.envelope('instructors', instructors, total, limit, offset)
    ), 200


@instructors_bp.route('/instructors/<instructor_name>', methods=['GET'])
def get_instructor(instructor_name):
    """One instructor, roster, days and ranked topics included.

    The name is the key, so it travels URL-encoded in the path. Wrapped in an object so
    a profile page's later additions do not move what is already here.
    """
    instructor = Instructor.find_by_name(instructor_name)
    if not instructor:
        return jsonify({'error': 'Instructor not found'}), 404

    return jsonify({'instructor': serialize(instructor)}), 200
