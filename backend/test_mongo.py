import os
import sys
from pymongo import MongoClient
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

# Test with sanitized credentials (without angle brackets, which are placeholder markers)
URI_SANITIZED = "mongodb+srv://talentlens_user:Milind166@cluster0.rpvivu5.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
URI_LITERAL = "mongodb+srv://<talentlens_user>:<Milind166>@cluster0.rpvivu5.mongodb.net/?appName=Cluster0"

def test_connection(uri, label):
    print(f"\n--- Testing MongoDB Connection ({label}) ---")
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Force connection verification
        client.admin.command("ping")
        print(" Connected successfully to MongoDB Atlas!")
        db = client["talentlens"]
        print(f" Database: {db.name}")
        collections = db.list_collection_names()
        print(f" Existing collections: {collections}")
        return True, uri
    except ServerSelectionTimeoutError as e:
        print(f" Connection timeout: {e}")
        return False, None
    except PyMongoError as e:
        print(f" PyMongo error: {e}")
        return False, None
    except Exception as e:
        print(f" Unexpected error: {e}")
        return False, None

if __name__ == "__main__":
    success, working_uri = test_connection(URI_SANITIZED, "Sanitized: talentlens_user:Milind166")
    if not success:
        success, working_uri = test_connection(URI_LITERAL, "Literal with brackets")
    
    if success:
        print(f"\n Successfully verified MongoDB URI!")
        sys.exit(0)
    else:
        print("\n Could not connect to MongoDB Atlas. Please check IP Access List (0.0.0.0/0) in Atlas or credentials.")
        sys.exit(1)
