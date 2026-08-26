from pymongo import MongoClient
from mongo_url import uri, db_name

class Database:
    """MongoDB database connection manager"""
    _client = None
    _db = None

    @classmethod
    def connect(cls):
        """Connect to MongoDB"""
        if cls._client is None:
            client = None
            try:
                client = MongoClient(uri)
                # Verify connection
                client.admin.command('ping')
            except Exception as e:
                # Nothing is published to the class until the ping succeeds. A client
                # cached here before it was verified would satisfy the guard above, so
                # every later connect() would short-circuit and get_db() would hand
                # back a None database for the rest of the process.
                if client is not None:
                    client.close()
                print(f"[!!] Failed to connect to MongoDB: {e}")
                raise

            cls._client = client
            cls._db = client[db_name]
            print("[ok] Connected to MongoDB")
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
            print("[ok] MongoDB connection closed")

# Create a global database instance
db = Database()
