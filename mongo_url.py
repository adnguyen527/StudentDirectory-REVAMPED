"""MongoDB connection string, loaded from the environment.

The URI carries cluster credentials, so it lives in .env (gitignored) rather than in
source. Copy .env.example to .env and fill in MONGODB_URI to get started.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load the repo-root .env explicitly: the ingestion scripts run from other working
# directories, and a bare load_dotenv() searches from the cwd.
load_dotenv(Path(__file__).parent / '.env')

uri = os.getenv('MONGODB_URI')
db_name = os.getenv('MONGODB_DB', 'StudentDirectory')

if not uri:
    raise RuntimeError()
