from flask import Flask
from flask_cors import CORS
import auth
from config import config
from database import db
from models import LoginSession, User
from routes import auth_bp, students_bp, instructors_bp, metrics_bp


def _check_origins():
    """A wildcard origin and cookie auth cannot both be true.

    Browsers refuse to send credentials to Access-Control-Allow-Origin: *, so this
    combination does not degrade -- it produces a login that appears to succeed and an
    app that is then anonymous on every subsequent request, with no error anywhere.
    Refusing to start is the only version of this that is debuggable.
    """
    if config.ALLOWED_ORIGINS == '*':
        raise RuntimeError(
            "ALLOWED_ORIGINS='*' cannot be combined with session authentication -- "
            'browsers do not send cookies to a wildcard origin. List the frontend '
            'origins explicitly, e.g. ALLOWED_ORIGINS=http://localhost:5173'
        )


def _warn_if_unreachable():
    """A server with no shared key and no accounts can be reached by nobody.

    This is the case the request guard used to answer 500 for. It belongs at startup
    instead: it is a deployment mistake, knowable once, and reporting it per request told
    an unauthenticated caller about the server's configuration.
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

    # X-API-Key is not a CORS-simple header, so a browser preflights every call. It has
    # to be allowed by name or the preflight fails before the real request is ever sent.
    #
    # supports_credentials is what permits the session cookie to cross from the frontend
    # origin to this one. Note that localhost:5173 -> localhost:5000 is cross-ORIGIN but
    # same-SITE (a port is not part of a site), which is why a SameSite=Lax cookie works
    # in development -- but only if both sides spell the host the same way. Mixing
    # localhost and 127.0.0.1 makes them cross-site and the cookie is silently dropped.
    CORS(
        app,
        resources={r"/api/*": {"origins": config.ALLOWED_ORIGINS}},
        allow_headers=['Content-Type', 'X-API-Key'],
        supports_credentials=True,
    )

    try:
        db.connect()
        # Neither collection has a builder to create these -- users and sessions are
        # authored, not rebuilt from dwp_reports like every other collection here.
        User.ensure_indexes()
        LoginSession.ensure_indexes()
        _warn_if_unreachable()
    except Exception as e:
        print(f"Warning: Could not connect to database: {e}")

    app.register_blueprint(auth_bp)
    app.register_blueprint(students_bp)
    app.register_blueprint(instructors_bp)
    app.register_blueprint(metrics_bp)

    # After the blueprints: the guard resolves request.endpoint, which needs the routes
    # registered to mean anything.
    auth.init_app(app)

    return app


if __name__ == '__main__':
    app = create_app()
    print(f"Serving on http://{config.HOST}:{config.PORT} (debug={config.DEBUG})")
    app.run(debug=config.DEBUG, host=config.HOST, port=config.PORT)
