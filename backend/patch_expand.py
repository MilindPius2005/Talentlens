with open("app.py", "r") as f:
    content = f.read()

expand_route = """
@app.route("/graph/expand/<path:node>", methods=["GET", "OPTIONS"])
def graph_expand(node):
    if request.method == "OPTIONS": return "", 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    
    if not GraphDatabase or not NEO4J_URI:
        return jsonify({"nodes": [], "links": []})
        
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD), connection_timeout=5)
    nodes = []
    links = []
    node_ids = set()
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            # First fetch the target node itself
            res1 = session.run("MATCH (n {name: $node}) RETURN labels(n) AS labels, n.name AS name", node=node)
            rec1 = res1.single()
            if not rec1:
                driver.close()
                return jsonify({"error": "Node not found"}), 404
                
            labels = rec1["labels"]
            ntype = labels[0] if labels else "Unknown"
            nodes.append({"id": node, "label": node, "type": ntype})
            node_ids.add(node)
            
            # Fetch neighbors and relationships
            res2 = session.run("MATCH (n {name: $node})-[r]-(m) RETURN type(r) AS relType, startNode(r).name AS start, endNode(r).name AS end, labels(m) AS mLabels, m.name AS mName", node=node)
            for rec in res2:
                m_name = rec["mName"]
                if m_name not in node_ids:
                    m_labels = rec["mLabels"]
                    m_type = m_labels[0] if m_labels else "Unknown"
                    nodes.append({"id": m_name, "label": m_name, "type": m_type})
                    node_ids.add(m_name)
                    
                links.append({
                    "source": rec["start"],
                    "target": rec["end"],
                    "type": rec["relType"]
                })
    except Exception as e:
        print(f"Expand error: {e}")
    finally:
        driver.close()
        
    return jsonify({"nodes": nodes, "links": links})
"""

if "@app.route(\"/graph/expand" not in content:
    content = content.replace("@app.route(\"/ingestion/uploads\",", expand_route + "\n@app.route(\"/ingestion/uploads\",")
    with open("app.py", "w") as f:
        f.write(content)
    print("Added /graph/expand to app.py")
