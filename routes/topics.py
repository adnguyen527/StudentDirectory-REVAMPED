from flask import Blueprint, jsonify, request

from models import Topic
from models.topic import FILTERABLE, SORTABLE
from routes import filtering, pagination, sorting
from routes.serialization import serialize

topics_bp = Blueprint('topics', __name__, url_prefix='/api')


@topics_bp.route('/topics', methods=['GET'])
def get_topics():
    """A page of topics, in the same envelope /api/students returns.

    Ordered by name, then topic_id -- 90 names are carried by more than one topic, four of
    them by four, so name alone is not a total order and a page could repeat or drop a row.
    """
    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    sort, direction, error = sorting.parse(request.args, SORTABLE)
    if error:
        return jsonify({'error': error}), 400

    ranges, error = filtering.parse(request.args, FILTERABLE)
    if error:
        return jsonify({'error': error}), 400

    query = request.args.get('query')
    if query:
        topics, total = Topic.search(query, limit, offset, sort, direction, ranges)
    else:
        topics, total = Topic.find_all(limit, offset, sort, direction, ranges)

    return jsonify(pagination.envelope('topics', topics, total, limit, offset)), 200


@topics_bp.route('/topics/search', methods=['GET'])
def search_topics():
    """Name search, matching the names a topic no longer goes by as well as its current
    one -- that is what also_known_as is for."""
    query = request.args.get('q', '')
    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    limit, offset, error = pagination.parse(request.args)
    if error:
        return jsonify({'error': error}), 400

    topics, total = Topic.search(query, limit, offset)

    return jsonify(pagination.envelope('topics', topics, total, limit, offset)), 200


@topics_bp.route('/topics/<topic_id>', methods=['GET'])
def get_topic(topic_id):
    """One topic, its instructor ranking included.

    Wrapped in an object so the detail page's later additions -- days to finish, the page
    figures -- do not move what is already here.
    """
    topic = Topic.find_by_id(topic_id)
    if not topic:
        return jsonify({'error': 'Topic not found'}), 404

    return jsonify({'topic': serialize(topic)}), 200
