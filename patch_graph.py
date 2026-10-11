import re

with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

# 1. Update GraphView signature
content = re.sub(
    r"function GraphView\(\{\s*user\s*\}\) \{",
    r"function GraphView({ user, setEmployees, setAlerts }) {",
    content
)

# 2. Add sbForm state
content = re.sub(
    r"const graphRef = useRef\(null\);",
    r"const graphRef = useRef(null);\n  const [sbForm, setSbForm] = useState({ job_id: '', manager_name: '' });\n  const [showSoftblockForm, setShowSoftblockForm] = useState(false);",
    content
)

# 3. Replace handleAction with the full updating version
handle_action = """
  async function handleAction(action, empId) {
    if (!user) return alert("Please log in first");
    const todayStr = new Date().toISOString().split("T")[0];
    try {
      const payload = action === 'softblock' ? { job_id: sbForm.job_id, job_label: sbForm.job_id, manager_name: sbForm.manager_name } : {};
      const res = await fetch(`${API_BASE}/employees/${encodeURIComponent(empId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const resData = await parseJsonSafe(res);
        setEmployees(prev => prev.map(emp => {
          if (emp.id !== empId) return emp;
          return {
            ...emp,
            status: action === "softblock" ? "SOFTBLOCKED" : "AVAILABLE",
            softblock_job: action === "softblock" ? (payload.job_label || payload.job_id || "Opportunity") : null,
            softblock_manager: action === "softblock" ? (payload.manager_name || user?.name || "Admin") : null,
            softblock_start: action === "softblock" ? todayStr : null,
            softblock_expiry: action === "softblock" ? new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0] : null
          };
        }));
        
        // Also update local selectedNode to reflect changes instantly in the panel
        setSelectedNode(prev => ({
          ...prev,
          status: action === "softblock" ? "SOFTBLOCKED" : "AVAILABLE",
          softblock_job: action === "softblock" ? (payload.job_label || payload.job_id || "Opportunity") : null,
          softblock_manager: action === "softblock" ? (payload.manager_name || user?.name || "Admin") : null,
          softblock_start: action === "softblock" ? todayStr : null,
          softblock_expiry: action === "softblock" ? new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0] : null
        }));

        if (setAlerts) {
          if (action === "softblock") {
            const newAlert = resData?.alert || {
              id: "SB" + String(Date.now()).slice(-6),
              type: "SOFTBLOCK",
              employee: selectedNode.label || selectedNode.id,
              employee_id: empId,
              job_description: payload.job_label || payload.job_id || "Opportunity",
              softblocked_by: payload.manager_name || user?.name || "Admin",
              expiry_date: new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0],
              sent_at: todayStr,
              recipient: "hr@company.com"
            };
            setAlerts(prev => [newAlert, ...prev.filter(a => !(a.employee === (selectedNode.label || selectedNode.id) && a.type === "RELEASE"))]);
          } else if (action === "release") {
            const newAlert = resData?.alert || {
              id: "REL" + String(Date.now()).slice(-6),
              type: "RELEASE",
              employee: selectedNode.label || selectedNode.id,
              employee_id: empId,
              job_description: selectedNode.softblock_job || "Opportunity",
              sent_at: todayStr,
              recipient: "hr@company.com"
            };
            setAlerts(prev => [newAlert, ...prev.filter(a => !(a.employee === (selectedNode.label || selectedNode.id) && a.type === "SOFTBLOCK"))]);
          }
        }
        
        setShowSoftblockForm(false);
      } else {
        const d = await parseJsonSafe(res);
        alert(d?.error || "Action failed");
      }
    } catch (e) {
      alert("Error: " + e.message);
    }
  }
"""

content = re.sub(
    r"\s*async function handleAction.*?catch \(e\) \{\n\s*alert\(\"Error: \" \+ e\.message\);\n\s*\}\n\s*\}",
    handle_action,
    content,
    flags=re.DOTALL
)

# 4. Replace the panel buttons
panel_ui = """
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                {(!selectedNode.status || selectedNode.status === 'AVAILABLE') ? (
                  showSoftblockForm ? (
                    <div style={{ padding: 12, background: "#FFFBEB", borderRadius: 8 }}>
                      <div style={{ fontWeight: 600, color: "#B8710F", marginBottom: 8 }}>Soft-block Details</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                        <input type="text" className="form-input" placeholder="Job ID (e.g., J001)" value={sbForm.job_id} onChange={e => setSbForm(prev => ({...prev, job_id: e.target.value}))} />
                        <input type="text" className="form-input" placeholder="Manager Name" value={sbForm.manager_name} onChange={e => setSbForm(prev => ({...prev, manager_name: e.target.value}))} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => handleAction('softblock', selectedNode.id)}>Submit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setShowSoftblockForm(false)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowSoftblockForm(true)} className="btn btn-amber" style={{ width: "100%", justifyContent: "center" }}>
                      ◐ Soft-block Employee
                    </button>
                  )
                ) : (
                  <>
                    <button onClick={() => handleAction('release', selectedNode.id)} className="btn" style={{ background: "#FDECEA", color: "#C0392B", width: "100%", justifyContent: "center" }}>
                      Release Employee
                    </button>
                  </>
                )}
              </div>
"""

content = re.sub(
    r"\s*<div style={{ display: \"flex\", flexDirection: \"column\", gap: 8, marginTop: 20 }}>\n\s*\{\(!selectedNode\.status.*?</div>\n\s*</div>\n\s*\)\}\n\s*</div>",
    panel_ui + "\n            </div>\n          )}\n        </div>",
    content,
    flags=re.DOTALL
)

# 5. Pass setAlerts and setEmployees to GraphView
content = re.sub(
    r"\{page === \"graph\" && <GraphView user=\{user\} />\}",
    r"{page === \"graph\" && <GraphView user={user} setEmployees={setEmployees} setAlerts={setAlerts} />}",
    content
)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("GraphView patched")
