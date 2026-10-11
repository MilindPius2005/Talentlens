import os
from pymongo import MongoClient
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv('MONGO_URI')
MONGO_DB_NAME = os.getenv('MONGO_DB_NAME', 'talentlens')
mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB_NAME]

print("Wiping MongoDB collections...")
for coll in ['users', 'sessions', 'change_requests', 'upload_history', 'alerts']:
    mongo_db[coll].delete_many({})
print("MongoDB wiped.")

NEO4J_URI = os.getenv('NEO4J_URI')
NEO4J_USER = os.getenv('NEO4J_USER')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')
NEO4J_DATABASE = os.getenv('NEO4J_DATABASE', 'neo4j')

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
print("Wiping Neo4j nodes and relationships...")
with driver.session(database=NEO4J_DATABASE) as session:
    session.run("MATCH (n) DETACH DELETE n")
print("Neo4j wiped.")

print("All databases have been successfully erased!")
