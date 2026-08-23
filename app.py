from flask import Flask
from flask_cors import CORS
from config import config
from database import db
from routes import students_bp, metrics_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object(config)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    try:
        db.connect()
    except Exception as e:
        print(f"Warning: Could not connect to database: {e}")

    app.register_blueprint(students_bp)
    app.register_blueprint(metrics_bp)

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, host='0.0.0.0', port=5000)
