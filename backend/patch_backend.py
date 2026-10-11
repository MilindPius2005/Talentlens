import os

with open("app.py", "r") as f:
    content = f.read()

# Add dotenv, pymongo, neo4j, pandas imports at the top
import_str = """
from dotenv import load_dotenv
load_dotenv()

try:
    from pymongo import MongoClient
except ImportError:
    MongoClient = None
try:
    from neo4j import GraphDatabase
except ImportError:
    GraphDatabase = None
try:
    import pandas as pd
except ImportError:
    pd = None
"""
if "from dotenv import load_dotenv" not in content:
    content = content.replace("from werkzeug.security", import_str + "\nfrom werkzeug.security")


# Add the entire Phase 4 logic block
phase4_block = """
# ──────────────────────────────────────────────────────────────────────────────
# Phase 3 & 4: Databases (MongoDB + Neo4j) & Document Ingestion
# ──────────────────────────────────────────────────────────────────────────────

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "talentlens")
NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j")

mongo_db = None
if MongoClient and MONGO_URI:
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command('ping')
        mongo_db = client[MONGO_DB_NAME]
        print("Connected to MongoDB Atlas!")
    except Exception as e:
        print(f"MongoDB connection failed: {e}")

@app.route("/health/db")
def health_db():
    res = {"mongo": {"connected": False}, "neo4j": {"connected": False}}
    if mongo_db is not None:
        res["mongo"]["connected"] = True
        res["mongo"]["database"] = MONGO_DB_NAME
    if GraphDatabase and NEO4J_URI:
        try:
            driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD), connection_timeout=5)
            driver.verify_connectivity()
            driver.close()
            res["neo4j"]["connected"] = True
            res["neo4j"]["uri"] = NEO4J_URI
        except Exception as e:
            res["neo4j"]["error"] = str(e)
    return jsonify(res)

REQUIRED_COLUMNS = ["Emp_Name", "Client_Name", "Skills"]
COLUMN_LABEL_MAP = {
    "Emp_Name": "Employee", "Client_Name": "Client", "Project": "Project",
    "Skills": "Skill", "misc skill": "Skill", "module": "Module", "Domain": "Domain",
    "skillgroup": "SkillGroup", "KPMG_Level": "Level", "SST": "Department", "Location": "Location"
}
NODE_COLUMNS = {"emp_name", "client_name", "project", "skills", "misc skill", "module", "domain", "skillgroup", "level", "kpmg_level", "location"}

def parse_skills(cell_val):
    import re
    if not cell_val or str(cell_val).lower() in ("nan", "none", ""): return []
    v = str(cell_val).replace(";", ",").replace("|", ",")
    return [s.strip() for s in v.split(",") if s.strip()]

@app.route("/ingestion/upload", methods=["POST", "OPTIONS"])
def ingestion_upload():
    if request.method == "OPTIONS": return "", 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    if "file" not in request.files: return jsonify({"error": "No file"}), 400
    
    file = request.files["file"]
    if not file.filename: return jsonify({"error": "No file name"}), 400
    
    # Parse file
    try:
        if file.filename.endswith(".csv"): df = pd.read_csv(file)
        elif file.filename.endswith((".xlsx", ".xls")): df = pd.read_excel(file)
        else: return jsonify({"error": "Unsupported file format (use .csv or .xlsx)"}), 400
        rows = df.to_dict(orient="records")
    except Exception as e:
        return jsonify({"error": f"Failed to parse file: {e}"}), 422
    
    if not rows: return jsonify({"error": "Empty file"}), 422
    
    columns = list(rows[0].keys())
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        return jsonify({"error": "Schema Validation Failed", "missing_columns": missing}), 422
        
    # Ingest to Neo4j
    nodes_count = 0
    rels_count = 0
    if GraphDatabase and NEO4J_URI:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD), connection_timeout=15)
        try:
            with driver.session(database=NEO4J_DATABASE) as session:
                primary_col = columns[0]
                primary_label = COLUMN_LABEL_MAP.get(primary_col, primary_col)
                
                for row in rows:
                    primary_val = str(row.get(primary_col, "")).strip()
                    if not primary_val: continue
                    
                    emp_props = {"owner": user["name"]}
                    for col in columns[1:]:
                        if col.strip().lower() not in NODE_COLUMNS:
                            val = row[col]
                            if val is not None and str(val).lower() not in ("nan", "none", ""):
                                emp_props[col.strip().lower().replace(" ", "_")] = str(val).strip()
                                
                    # Create Primary Node (Employee)
                    session.run(
                        f"MERGE (n:`{primary_label}` {{name: $name, owner: $owner}}) SET n += $props",
                        name=primary_val, owner=user["name"], props=emp_props
                    )
                    nodes_count += 1
                    
                    # Create Related Nodes & Edges
                    for col in columns[1:]:
                        if col.strip().lower() not in NODE_COLUMNS: continue
                        cell_val = str(row.get(col, "")).strip()
                        if not cell_val or cell_val.lower() in ("nan", "none", ""): continue
                        
                        rel_type = col.upper().replace(" ", "_").replace("-", "_")
                        col_label = next((v for k, v in COLUMN_LABEL_MAP.items() if k.lower() == col.strip().lower()), col.strip())
                        
                        vals_to_process = parse_skills(cell_val) if col_label == "Skill" else [cell_val]
                        for val in vals_to_process:
                            session.run(f"MERGE (n:`{col_label}` {{name: $name, owner: $owner}})", name=val, owner=user["name"])
                            session.run(
                                f"MATCH (a:`{primary_label}` {{name: $primary, owner: $owner}}) "
                                f"MATCH (b:`{col_label}` {{name: $related, owner: $owner}}) "
                                f"MERGE (a)-[r:`{rel_type}`]->(b) ON CREATE SET r.owner = $owner",
                                primary=primary_val, related=val, owner=user["name"]
                            )
                            nodes_count += 1
                            rels_count += 1
        except Exception as e:
            driver.close()
            return jsonify({"error": f"Neo4j ingestion failed: {e}"}), 500
        finally:
            driver.close()
            
    # Record upload in MongoDB
    record = {
        "id": uuid.uuid4().hex,
        "filename": file.filename,
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "totalRows": len(rows),
        "totalNodes": nodes_count,
        "totalRelationships": rels_count,
        "status": "completed",
        "username": user["name"],
    }
    if mongo_db is not None:
        mongo_db["upload_history"].insert_one(record)
    else:
        # Fallback local persistence
        hx = _read_json(DATA_DIR / "uploads.json", [])
        hx.insert(0, record)
        _write_json(DATA_DIR / "uploads.json", hx)
        
    return jsonify(record)

@app.route("/ingestion/uploads", methods=["GET", "OPTIONS"])
def get_ingestion_uploads():
    if request.method == "OPTIONS": return "", 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    
    if mongo_db is not None:
        records = list(mongo_db["upload_history"].find({"username": user["name"]}, {"_id": 0}).sort("uploadedAt", -1).limit(50))
    else:
        records = [r for r in _read_json(DATA_DIR / "uploads.json", []) if r["username"] == user["name"]]
        
    return jsonify({"uploads": records})

# ──────────────────────────────────────────────────────────────────────────────
# Entry point
"""

if "# Phase 3 & 4" not in content:
    content = content.replace("# ──────────────────────────────────────────────────────────────────────────────\n# Entry point", phase4_block)
    with open("app.py", "w") as f:
        f.write(content)
    print("Backend patched successfully with Phase 4 Ingestion pipeline!")
else:
    print("Backend already patched.")
