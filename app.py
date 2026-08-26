from flask import Flask
from flask_cors import CORS
import auth
from config import config
from database import db
from routes import students_bp, metrics_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object(config)

    # X-API-Key is not a CORS-simple header, so a browser preflights every call. It has
    # to be allowed by name or the preflight fails before the real request is ever sent.
    CORS(
        app,
        resources={r"/api/*": {"origins": config.ALLOWED_ORIGINS}},
        allow_headers=['Content-Type', 'X-API-Key'],
    )

    try:
        db.connect()
    except Exception as e:
        print(f"Warning: Could not connect to database: {e}")

    app.register_blueprint(students_bp)
    app.register_blueprint(metrics_bp)

    # After the blueprints: the guard resolves request.endpoint, which needs the routes
    # registered to mean anything.
    auth.init_app(app)

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
