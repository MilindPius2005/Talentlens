from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv('backend/.env')
uri = os.getenv('MONGO_URI')
client = MongoClient(uri)
db = client['talentlens']

print("Before:")
print(f"Users: {db.users.count_documents({})}")
print(f"Sessions: {db.sessions.count_documents({})}")

db.users.delete_many({})
db.sessions.delete_many({})

print("After:")
print(f"Users: {db.users.count_documents({})}")
print(f"Sessions: {db.sessions.count_documents({})}")
