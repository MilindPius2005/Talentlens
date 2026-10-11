import sys
from neo4j import GraphDatabase

NEO4J_URI = "neo4j+s://2afdb49d.databases.neo4j.io"
NEO4J_USER = "2afdb49d"
NEO4J_PASSWORD = "qqcFa-50noz8ZM_womxg49mpK12xsyMZWK6tQHF0jSM"
NEO4J_DATABASE = "2afdb49d"

print(f"Testing Neo4j with user '{NEO4J_USER}'...", flush=True)
try:
    driver = GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
        connection_timeout=15,
    )
    driver.verify_connectivity()
    print(" SUCCESS! Connected to Neo4j AuraDB!", flush=True)
    
    with driver.session(database=NEO4J_DATABASE) as session:
        # Check existing node count
        count_result = session.run("MATCH (n) RETURN count(n) AS total_nodes")
        node_count = count_result.single()["total_nodes"]
        print(f" Existing nodes in graph: {node_count}", flush=True)
        
    driver.close()
    sys.exit(0)
except Exception as e:
    print(f" Failed: {type(e).__name__}: {e}", flush=True)
    sys.exit(1)
