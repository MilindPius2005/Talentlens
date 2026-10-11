with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

# Add Ingestion to PAGES
pages_old = '{ id:"alerts", icon:"🔔", label:"Alerts" },\n  { id:"graph", icon:"⬡", label:"Graph" },'
pages_new = '{ id:"alerts", icon:"🔔", label:"Alerts" },\n  { id:"graph", icon:"⬡", label:"Graph" },\n  { id:"ingestion", icon:"📥", label:"Ingestion" },'
content = content.replace(pages_old, pages_new)

# Add Ingestion Component function before TalentLens()
ingestion_comp = """function Ingestion() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  
  useEffect(() => {
    fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.uploads) setHistory(d.uploads); })
      .catch(e => console.error(e));
  }, []);
  
  async function handleUpload(e) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/ingestion/upload`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setHistory(prev => [data, ...prev]);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }
  
  return (
    <div>
      <div className="page-header">
        <div className="page-title">Document Ingestion</div>
        <div className="page-sub">Upload CSV or Excel files to populate the Knowledge Graph & Databases.</div>
      </div>
      
      <div className="card" style={{ marginBottom: 24, maxWidth: 600 }}>
        <div className="card-title">Upload New Document</div>
        {error && <div style={{ color: "#C0392B", background: "#FDECEA", padding: "10px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
        <form onSubmit={handleUpload} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={e => setFile(e.target.files[0])} />
          <button type="submit" className="btn btn-primary" disabled={!file || uploading} style={{ alignSelf: "flex-start" }}>
            {uploading ? "Uploading & Processing..." : "Upload & Ingest"}
          </button>
        </form>
      </div>
      
      <div className="card">
        <div className="card-title">Upload History</div>
        {history.length === 0 ? (
          <div className="empty">No uploads yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Date</th>
                  <th>Rows</th>
                  <th>Nodes Added</th>
                  <th>Relationships Added</th>
                  <th>User</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td style={{ fontWeight: 600 }}>{h.filename}</td>
                    <td>{new Date(h.uploadedAt).toLocaleString()}</td>
                    <td>{h.totalRows}</td>
                    <td>{h.totalNodes}</td>
                    <td>{h.totalRelationships}</td>
                    <td>{h.username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────"""

if "function Ingestion()" not in content:
    content = content.replace("// ─── App shell ────────────────────────────────────────────────────────────────", ingestion_comp)

# Add route logic
route_old = '{page === "graph" && <div style={{height:"calc(100vh - 108px)"}}><GraphExplorer alerts={alerts} setAlerts={setAlerts} liveEmployees={graphEmployees} setLiveEmployees={setGraphEmployees} /></div>}'
route_new = route_old + '\n            {page === "ingestion" && <Ingestion />}'
if '{page === "ingestion"' not in content:
    content = content.replace(route_old, route_new)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("UI patched with Ingestion view!")
