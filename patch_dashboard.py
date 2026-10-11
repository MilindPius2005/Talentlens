import re

with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

# Add grid3 to css
content = re.sub(
    r"\.grid2 \{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; \}",
    r".grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }\n  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }",
    content
)

# In Dashboard, get softblocked
content = re.sub(
    r"const available = employees\.filter\(e => e\.status === \"AVAILABLE\"\);",
    r"const available = employees.filter(e => e.status === \"AVAILABLE\");\n  const softblocked = employees.filter(e => e.status === \"SOFTBLOCKED\");",
    content
)

# Change grid2 to grid3 in Dashboard
content = re.sub(
    r"<div className=\"grid2\" style={{ marginBottom: 20 }}>\n\s*<div className=\"card\">\n\s*<div className=\"card-title\">Bench aging snapshot</div>",
    r"<div className=\"grid3\" style={{ marginBottom: 20 }}>\n        <div className=\"card\">\n          <div className=\"card-title\">Bench aging snapshot</div>",
    content
)

# Add the 3rd column
softblock_col = """
        <div className="card">
          <div className="card-title">Soft-blocked personnel</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {softblocked.length === 0 && <div style={{ fontSize:12, color:T.muted }}>No employees are currently soft-blocked.</div>}
            {softblocked.map(e => (
              <div key={e.id} style={{ display:"flex", flexDirection:"column", gap:2, paddingBottom:8, borderBottom:`1px solid ${T.line}` }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}>
                  <span style={{ fontSize:13, fontWeight:600 }}>{e.name}</span>
                  <span style={{ fontSize:11, color:T.amber }}>{e.softblock_expiry ? "Expires " + e.softblock_expiry : ""}</span>
                </div>
                <div style={{ fontSize:12, color:T.muted }}>{e.softblock_job || "Opportunity"}</div>
                <div style={{ fontSize:11, color:T.muted }}>By {e.softblock_manager || "Manager"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
"""

content = re.sub(
    r"</div>\n\s*</div>\n\s*<div className=\"card\">\n\s*<div className=\"card-title\">Skill supply overview</div>",
    softblock_col + '        <div className="card-title">Skill supply overview</div>',
    content
)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("Dashboard patched")
