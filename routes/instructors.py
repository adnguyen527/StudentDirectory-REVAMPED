from flask import Blueprint, jsonify, request

from models import Instructor
from routes import pagination
from routes.serialization import serialize

instructors_bp = Blueprint('instructors', __name__, url_prefix='/api')


@instructors_bp.route('/instructors', methods=['GET'])
def get_instructors():
    """A page of instructors, in the same envelope /api/students returns.

    103 documents do not need paging today. They share the shape anyway so the frontend
    learns one convention, and so the roster can grow without the route changing.
    """
    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    query = request.args.get('query')
    if query:
        instructors, total = Instructor.search(query, limit, offset)
    else:
        instructors, total = Instructor.find_all(limit, offset)

    return jsonify(
        pagination.envelope('instructors', instructors, total, limit, offset)
    ), 200


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
    """One instructor, roster and days included.

    The name is the key -- it is all the source data carries -- so it travels in the
    path URL-encoded. Wrapped in an object rather than returned bare, so the sessions
    or stats a profile page may want later can be added without moving what is here.
    """
    instructor = Instructor.find_by_name(instructor_name)
    if not instructor:
        return jsonify({'error': 'Instructor not found'}), 404

    return jsonify({'instructor': serialize(instructor)}), 200
