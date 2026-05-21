from pymongo import MongoClient
from mongo_url import uri

class Database:
    """MongoDB database connection manager"""
    _client = None
    _db = None

    @classmethod
    def connect(cls):
        """Connect to MongoDB"""
        if cls._client is None:
            try:
                cls._client = MongoClient(uri)
                # Verify connection
                cls._client.admin.command('ping')
                cls._db = cls._client['StudentDirectory']
                print("✓ Connected to MongoDB")
            except Exception as e:
                print(f"✗ Failed to connect to MongoDB: {e}")
                raise
        return cls._db

    @classmethod
    def get_db(cls):
        """Get database instance"""
        if cls._db is None:
            cls.connect()
        return cls._db

    @classmethod
    def close(cls):
        """Close MongoDB connection"""
        if cls._client is not None:
            cls._client.close()
            cls._client = None
            cls._db = None
            print("✓ MongoDB connection closed")

# Create a global database instance
db = Database()
