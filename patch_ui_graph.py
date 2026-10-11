with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

import_statement = "import OntologyGraph from './OntologyGraph';\n"
if "import OntologyGraph" not in content:
    content = content.replace('import React, { useState, useEffect, useRef } from "react";', 'import React, { useState, useEffect, useRef } from "react";\n' + import_statement)

graph_view_comp = """function GraphView() {
  const [graph, setGraph] = useState({ nodes: [], links: [] });
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const graphRef = useRef(null);

  async function handleExpand(node) {
    if (!node || !node.id) return;
    try {
      const res = await fetch(`${API_BASE}/graph/expand/${encodeURIComponent(node.id)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Expand failed");
      const data = await res.json();
      
      setGraph(prev => {
        const existingNodeIds = new Set(prev.nodes.map(n => n.id));
        const newNodes = data.nodes.filter(n => !existingNodeIds.has(n.id));
        
        const existingLinks = new Set(prev.links.map(l => `${l.source.id || l.source}-${l.target.id || l.target}`));
        const newLinks = data.links.filter(l => !existingLinks.has(`${l.source}-${l.target}`));
        
        return {
          nodes: [...prev.nodes, ...newNodes],
          links: [...prev.links, ...newLinks]
        };
      });
      
      setExpandedIds(prev => {
        const next = new Set(prev);
        next.add(node.id);
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }

  function handleCollapse(node) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.delete(node.id);
      return next;
    });
    // For a robust collapse, we'd need to compute reachability from the search root.
    // For simplicity, we just unmark it as expanded.
  }

  function handleSearch(e) {
    e.preventDefault();
    if (!search.trim()) return;
    setGraph({ nodes: [], links: [] });
    setExpandedIds(new Set());
    handleExpand({ id: search.trim() });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 108px)" }}>
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div className="page-title">Knowledge Graph</div>
        <div className="page-sub">Explore the unified talent ontology from Neo4j.</div>
        <form onSubmit={handleSearch} style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <input type="text" className="form-input" placeholder="Search node (e.g., React)..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 300 }} />
          <button type="submit" className="btn btn-primary">Search & Expand</button>
        </form>
      </div>
      <div style={{ flex: 1, position: "relative", background: "#0a0a0a", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        {graph.nodes.length === 0 ? (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", color: "rgba(255,255,255,0.3)" }}>
            Search a node to begin exploring the ontology graph.
          </div>
        ) : (
          <OntologyGraph 
            ref={graphRef}
            graph={graph}
            rootNode={search.trim()}
            expandedNodeIds={expandedIds}
            onNodeExpand={handleExpand}
            onNodeCollapse={handleCollapse}
            onNodeSelect={(n) => console.log("Selected:", n)}
          />
        )}
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────"""

if "function GraphView()" not in content:
    content = content.replace("// ─── App shell ────────────────────────────────────────────────────────────────", graph_view_comp)

route_old = '{page === "graph" && <div style={{height:"calc(100vh - 108px)"}}><GraphExplorer alerts={alerts} setAlerts={setAlerts} liveEmployees={graphEmployees} setLiveEmployees={setGraphEmployees} /></div>}'
route_new = '{page === "graph" && <GraphView />}'
if route_old in content:
    content = content.replace(route_old, route_new)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("Graph View patched!")
