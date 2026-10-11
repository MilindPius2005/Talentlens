import sys
from neo4j import GraphDatabase

NEO4J_URI = "neo4j+s://2afdb49d.databases.neo4j.io"
PASSWORDS = [
    "qqcFa-50noz8ZM_womxg49mpK12xsyMZWK6tQHF0jSM",
    "qqcFa-50noz8ZM_womxg49mpK12xsyMZWK6tQHF0jSM".strip(),
]

for pwd in set(PASSWORDS):
    print(f"Testing password: {pwd[:8]}... (len {len(pwd)})", flush=True)
    driver = None
    try:
        driver = GraphDatabase.driver(NEO4J_URI, auth=("neo4j", pwd))
        driver.verify_connectivity()
        print(" SUCCESS! Connected to Neo4j AuraDB!")
        sys.exit(0)
    except Exception as e:
        print(f" Failed: {e}")
    finally:
        if driver:
            driver.close()

print("All password attempts failed.")
