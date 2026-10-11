with open('/Users/milindpius/Documents/talentlens-ui/src/TalentLens.tsx', 'r') as f:
    content = f.read()

import re

# Patch handleFilterChange mapping
content = content.replace(
    'const nodes = employees.map(e => ({ id: e.id || e.name, label: e.name, type: "Employee" }));',
    'const nodes = employees.map(e => ({ id: e.id || e.name, label: e.name, type: "Employee", ...e }));'
)

# Patch GraphView function definition to include user and API requests
old_graphview = """function GraphView() {
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const graphRef = useRef(null);"""

new_graphview = """function GraphView({ user }) {
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState(null);
  const graphRef = useRef(null);

  async function handleAction(action, empId) {
    if (!user) return alert("Please log in first");
    try {
      const payload = action === 'softblock' ? { job_id: 'J001', job_label: 'Selected Job', manager_name: user.name } : {};
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(empId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert(user.role === 'Admin' ? `Successfully updated to ${action}` : `Requested ${action}. Admin approval pending.`);
        setSelectedNode(null);
      } else {
        const d = await res.json();
        alert(d.error || "Action failed");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  }
"""
content = content.replace(old_graphview, new_graphview)

# Replace <GraphView /> invocation in TalentLens
content = content.replace('<GraphView />', '<GraphView user={user} />')

# Add the UI Panel in the GraphView render
old_render = """            <OntologyGraph 
              ref={graphRef}
              graph={graph}
              rootNode={search.trim()}
              expandedNodeIds={expandedIds}
              onNodeExpand={handleExpand}
              onNodeCollapse={handleCollapse}
              onNodeSelect={(n) => console.log("Selected:", n)}
            />
          )}
        </div>"""

new_render = """            <OntologyGraph 
              ref={graphRef}
              graph={graph}
              rootNode={search.trim()}
              expandedNodeIds={expandedIds}
              onNodeExpand={handleExpand}
              onNodeCollapse={handleCollapse}
              onNodeSelect={(n) => setSelectedNode(n)}
            />
          )}
          
          {selectedNode && selectedNode.type === 'Employee' && (
            <div style={{
              position: "absolute", top: 16, right: 16, width: 320, background: "#ffffff",
              border: "1px solid #E2E6EF", borderRadius: 12, padding: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 18, color: "#1E2233" }}>{selectedNode.label}</h3>
                <button onClick={() => setSelectedNode(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#8B929E" }}>&times;</button>
              </div>
              
              <div style={{ marginBottom: 8, fontSize: 13, color: "#4B5563" }}>
                <strong>Status:</strong> <span style={{ color: selectedNode.status === 'AVAILABLE' ? '#1A7A50' : '#B8710F' }}>{selectedNode.status || 'AVAILABLE'}</span>
              </div>
              {selectedNode.available_since && (
                <div style={{ marginBottom: 16, fontSize: 13, color: "#4B5563" }}>
                  <strong>Bench Since:</strong> {selectedNode.available_since}
                </div>
              )}
              
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                {(!selectedNode.status || selectedNode.status === 'AVAILABLE') ? (
                  <button onClick={() => handleAction('softblock', selectedNode.id)} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
                    Softblock Employee
                  </button>
                ) : (
                  <>
                    <button onClick={() => handleAction('release', selectedNode.id)} className="btn" style={{ background: "#FDECEA", color: "#C0392B", width: "100%", justifyContent: "center" }}>
                      Release Employee
                    </button>
                    <button onClick={() => handleAction('snooze', selectedNode.id)} className="btn btn-secondary" style={{ width: "100%", justifyContent: "center" }}>
                      Snooze Softblock (15 days)
                    </button>
                  </>
                )}
                {user?.role !== 'Admin' && (
                  <div style={{ fontSize: 11, color: "#8B929E", textAlign: "center", marginTop: 4 }}>
                    Actions will be sent as a request for Admin approval.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>"""
content = content.replace(old_render, new_render)

with open('/Users/milindpius/Documents/talentlens-ui/src/TalentLens.tsx', 'w') as f:
    f.write(content)
print("Patched GraphView")
