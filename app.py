from flask import Flask
from flask_cors import CORS
import auth
from config import config
from database import db
from models import LoginSession, User
from routes import auth_bp, students_bp, instructors_bp, topics_bp, metrics_bp


def _check_origins():
    """A wildcard origin and cookie auth cannot both hold.

    Browsers refuse credentials to `Access-Control-Allow-Origin: *`, so the combination
    does not degrade -- login appears to succeed and every later request is anonymous,
    with no error anywhere. Refusing to start is the debuggable version.
    """
    if config.ALLOWED_ORIGINS == '*':
        raise RuntimeError(
            "ALLOWED_ORIGINS='*' cannot be combined with session authentication -- "
            'browsers do not send cookies to a wildcard origin. List the frontend '
            'origins explicitly, e.g. ALLOWED_ORIGINS=http://localhost:5173'
        )


def _warn_if_unreachable():
    """A server with no shared key and no accounts can be reached by nobody.

    Reported here rather than per request, which would describe the configuration to an
    unauthenticated caller.
    """
    if config.API_KEY:
        return
    if User.count_all() == 0:
        print(
            '[!!] No API_KEY and no user accounts -- every protected route will answer '
            '401. Create an account with: python scripts/create_user.py <username>'
        )


def create_app():
    app = Flask(__name__)
    app.config.from_object(config)

    _check_origins()

    # X-API-Key is not CORS-simple, so it must be allowed by name or every preflight
    # fails before the real request is sent. supports_credentials lets the session cookie
    # cross origins -- but only if both sides spell the host the same way: mixing
    # localhost and 127.0.0.1 makes them cross-SITE and the cookie is silently dropped.
    CORS(
        app,
        resources={r"/api/*": {"origins": config.ALLOWED_ORIGINS}},
        allow_headers=['Content-Type', 'X-API-Key'],
        supports_credentials=True,
    )

    try:
        db.connect()
        # No builder creates these: users and sessions are authored, not rebuilt from
        # dwp_reports like every other collection here.
        User.ensure_indexes()
        LoginSession.ensure_indexes()
        _warn_if_unreachable()
    except Exception as e:
        print(f"Warning: Could not connect to database: {e}")

    app.register_blueprint(auth_bp)
    app.register_blueprint(students_bp)
    app.register_blueprint(instructors_bp)
    app.register_blueprint(topics_bp)
    app.register_blueprint(metrics_bp)

    # After the blueprints: the guard resolves request.endpoint, which needs the routes
    # registered to mean anything.
    auth.init_app(app)

    return app


if __name__ == '__main__':
    app = create_app()
    print(f"Serving on http://{config.HOST}:{config.PORT} (debug={config.DEBUG})")
    app.run(debug=config.DEBUG, host=config.HOST, port=config.PORT)
