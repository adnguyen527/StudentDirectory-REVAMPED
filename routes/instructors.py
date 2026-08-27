from flask import Blueprint, jsonify, request

from models import Instructor
from routes.serialization import serialize

instructors_bp = Blueprint('instructors', __name__, url_prefix='/api')


@instructors_bp.route('/instructors', methods=['GET'])
def get_instructors():
    query = request.args.get('query')
    instructors = Instructor.search(query) if query else Instructor.find_all()

    return jsonify(serialize(instructors)), 200


@instructors_bp.route('/instructors/search', methods=['GET'])
def search_instructors():
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    return jsonify(serialize(Instructor.search(query))), 200


@instructors_bp.route('/instructors/<instructor_name>', methods=['GET'])
def get_instructor(instructor_name):
    """One instructor, roster and days included.

    The name is the key -- it is all the source data carries -- so it travels in the
    path URL-encoded. Wrapped in an object rather than returned bare, so the sessions
    or stats a profile page may want later can be added without moving what is here.
    """
    instructor = Instructor.find_by_name(instructor_name)
    if not instructor:
        return jsonify({'error': 'Instructor not found'}), 404

    return jsonify({'instructor': serialize(instructor)}), 200
