from flask import Blueprint, jsonify
from models import Student, DigitalWorkoutPlan, Attendance

metrics_bp = Blueprint('metrics', __name__, url_prefix='/api')

@metrics_bp.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'Backend is running'}), 200

@metrics_bp.route('/metrics', methods=['GET'])
def get_metrics():
    try:
        total_students = Student.count_all()
        total_dwp_reports = DigitalWorkoutPlan.count_all()
        total_attendance_records = Attendance.count_all()

        return jsonify({
            'total_students': total_students,
            'total_dwp_reports': total_dwp_reports,
            'total_attendance_records': total_attendance_records,
            'avg_dwp_per_student': round(total_dwp_reports / total_students, 2) if total_students else 0,
            'avg_attendance_per_student': round(total_attendance_records / total_students, 2) if total_students else 0
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
