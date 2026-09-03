from flask import Blueprint, jsonify
from models import Student, Instructor, DigitalWorkoutPlan, Attendance
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
