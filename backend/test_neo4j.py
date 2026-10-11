import sys
from neo4j import GraphDatabase

NEO4J_URI = "neo4j+s://2afdb49d.databases.neo4j.io"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "qqcFa-50noz8ZM_womxg49mpK12xsyMZWK6tQHF0jSM"
NEO4J_DATABASE = "neo4j"

print("1. Creating Neo4j Driver...", flush=True)
try:
    driver = GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
        connection_timeout=15,
        max_connection_lifetime=30,
    )
    print("2. Verifying connectivity...", flush=True)
    driver.verify_connectivity()
    print(" Connected successfully to Neo4j AuraDB!", flush=True)
    
    with driver.session(database=NEO4J_DATABASE) as session:
        print("3. Executing test Cypher query...", flush=True)
        res = session.run("RETURN 'AuraDB Connected' AS status, count { MATCH (n) } AS total_nodes")
        rec = res.single()
        print(f" Status: {rec['status']}, Total nodes: {rec['total_nodes']}", flush=True)
        
    driver.close()
    print(" Verified Neo4j AuraDB credentials!", flush=True)
except Exception as e:
    print(f" Error: {type(e).__name__}: {e}", flush=True)
    sys.exit(1)
