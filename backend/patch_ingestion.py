import sys
import re

with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'r') as f:
    content = f.read()

# Find the start of the with get_neo4j_driver() block in upload_file
start_str = "    with get_neo4j_driver() as driver:"
end_str = "    mongo_db['upload_history'].insert_one({"

if start_str not in content:
    print("Could not find start string")
    sys.exit(1)

start_idx = content.find(start_str)
end_idx = content.find(end_str)

new_block = """    # Optimized Batch Processing
    records = []
    for _, row in df.iterrows():
        emp_name = str(row['Emp_Name']).strip()
        if not emp_name or pd.isna(row.get('Emp_Name')) or emp_name == 'nan':
            continue
            
        rec = {
            'emp_name': emp_name,
            'client_name': str(row.get('Client_Name')).strip() if not pd.isna(row.get('Client_Name')) else None,
            'skills': parse_skills(row.get('Skills')) if not pd.isna(row.get('Skills')) else [],
            'misc_skills': parse_skills(row.get('misc skill')) if not pd.isna(row.get('misc skill')) else [],
            'domain': parse_skills(row.get('Domain')) if 'Domain' in df.columns and not pd.isna(row.get('Domain')) else [],
            'location': parse_skills(row.get('Location')) if 'Location' in df.columns and not pd.isna(row.get('Location')) else [],
            'level': []
        }
        
        # Handle Level variations
        for lvl_col in ['Level', 'KPMG_Level']:
            if lvl_col in df.columns and not pd.isna(row.get(lvl_col)):
                rec['level'].extend(parse_skills(row.get(lvl_col)))
                
        records.append(rec)
        
    if not records:
        return jsonify({"error": "No valid employee records found"}), 400

    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                # 1. Merge Employees
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    MERGE (e:Employee {name: rec.emp_name})
                    ON CREATE SET e.owner = $owner, e.status = 'AVAILABLE', e.available_since = $today
                    ON MATCH SET e.owner = $owner
                    \"\"\",
                    records=records, owner=owner, today=today_date
                )
                
                # 2. Merge Clients
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    WITH rec WHERE rec.client_name IS NOT NULL AND rec.client_name <> '' AND rec.client_name <> 'nan'
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (c:Client {name: rec.client_name})
                    ON CREATE SET c.owner = $owner
                    MERGE (e)-[:WORKED_FOR]->(c)
                    \"\"\",
                    records=records, owner=owner
                )
                
                # 3. Merge Skills
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    UNWIND rec.skills AS skill
                    WITH rec, skill WHERE skill <> ''
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (s:Skill {name: skill})
                    ON CREATE SET s.owner = $owner
                    MERGE (e)-[:HAS_SKILL]->(s)
                    \"\"\",
                    records=records, owner=owner
                )
                
                # 4. Merge Misc Skills
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    UNWIND rec.misc_skills AS skill
                    WITH rec, skill WHERE skill <> ''
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (s:Skill {name: skill})
                    ON CREATE SET s.owner = $owner
                    MERGE (e)-[:HAS_MISC_SKILL]->(s)
                    \"\"\",
                    records=records, owner=owner
                )
                
                # 5. Merge Domains
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    UNWIND rec.domain AS d
                    WITH rec, d WHERE d <> ''
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (dom:Domain {name: d})
                    MERGE (e)-[:HAS_DOMAIN]->(dom)
                    \"\"\",
                    records=records
                )
                
                # 6. Merge Locations
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    UNWIND rec.location AS l
                    WITH rec, l WHERE l <> ''
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (loc:Location {name: l})
                    MERGE (e)-[:HAS_LOCATION]->(loc)
                    \"\"\",
                    records=records
                )
                
                # 7. Merge Levels
                session.run(
                    \"\"\"
                    UNWIND $records AS rec
                    UNWIND rec.level AS l
                    WITH rec, l WHERE l <> ''
                    MATCH (e:Employee {name: rec.emp_name})
                    MERGE (lvl:Level {name: l})
                    MERGE (e)-[:HAS_LEVEL]->(lvl)
                    \"\"\",
                    records=records
                )
    except Exception as e:
        print(f"Ingestion Error: {e}")
        return jsonify({"error": f"Database insertion failed: {str(e)}"}), 500

"""

new_content = content[:start_idx] + new_block + content[end_idx:]

with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'w') as f:
    f.write(new_content)
    
print("Patched successfully")
