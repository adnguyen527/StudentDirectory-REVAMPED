from flask import Flask
from flask_cors import CORS
from config import config
from database import db
from routes import api

def create_app():
    """Application factory"""
    app = Flask(__name__)

    # Load configuration
    app.config.from_object(config)

    # Enable CORS for all routes
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Connect to database
    try:
        db.connect()
    except Exception as e:
        print(f"Warning: Could not connect to database: {e}")

    # Register blueprints
    app.register_blueprint(api)

    @app.teardown_appcontext
    def shutdown_session(exception=None):
        """Close database connection on app shutdown"""
        db.close()

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
