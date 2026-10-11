import re

with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

# 1. Update fetch calls with credentials
content = content.replace(
    'fetch(`${API_BASE}/employees`)',
    'fetch(`${API_BASE}/employees`, { credentials: "include" })'
)
content = content.replace(
    'fetch(`${API_BASE}/alerts`)',
    'fetch(`${API_BASE}/alerts`, { credentials: "include" })'
)
content = content.replace(
    'fetch(`${API_BASE}/employees/${emp.id}/softblock`, {',
    'fetch(`${API_BASE}/employees/${emp.id}/softblock`, {\n      credentials: "include",'
)
content = content.replace(
    'fetch(`${API_BASE}/employees/${emp.id}/release`, { method: "POST" })',
    'fetch(`${API_BASE}/employees/${emp.id}/release`, { method: "POST", credentials: "include" })'
)
content = content.replace(
    'fetch(`${API_BASE}/employees/${alert.employee_id}/release`, { method: "POST" })',
    'fetch(`${API_BASE}/employees/${alert.employee_id}/release`, { method: "POST", credentials: "include" })'
)
content = content.replace(
    'fetch(`${API_BASE}/employees/${alert.employee_id}/snooze`, { method: "POST" })',
    'fetch(`${API_BASE}/employees/${alert.employee_id}/snooze`, { method: "POST", credentials: "include" })'
)

# 2. Update Dashboard component
dashboard_old = """function Dashboard({ employees, jobs, alerts }) {
  const available = employees.filter(e => e.status === "AVAILABLE");"""
dashboard_new = """function Dashboard({ employees, jobs, alerts, user, onLogout }) {
  const available = employees.filter(e => e.status === "AVAILABLE");"""
content = content.replace(dashboard_old, dashboard_new)

dashboard_header_old = """      <div className="page-header">
        <div className="page-title">Dashboard</div>
        <div className="page-sub">Live view of your bench — every idle day is a cost</div>
      </div>"""
dashboard_header_new = """      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Live view of your bench — every idle day is a cost</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #E2E6EF", borderRadius: 12, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4B5563", textTransform: "uppercase", letterSpacing: 0.5 }}>Profile Details</div>
          <div><div style={{ fontSize: 11, color: "#8B929E" }}>Name</div><div style={{ fontSize: 14, fontWeight: 600 }}>{user?.name || "Loading..."}</div></div>
          <div><div style={{ fontSize: 11, color: "#8B929E" }}>Email</div><div style={{ fontSize: 13 }}>{user?.email || "..."}</div></div>
          <div><div style={{ fontSize: 11, color: "#8B929E" }}>Role</div><div style={{ fontSize: 13, fontWeight: 500, color: user?.role === "Admin" ? "#B8710F" : "#0A7C88" }}>{user?.role || "..."}</div></div>
          <button className="btn btn-ghost" style={{ marginTop: 4, width: "100%", justifyContent: "center" }} onClick={onLogout}>Logout</button>
        </div>
      </div>"""
content = content.replace(dashboard_header_old, dashboard_header_new)

# 3. Add auth state and effects to TalentLens
talentlens_old = """export default function TalentLens() {
  const [page, setPage] = useState("dashboard");"""
talentlens_new = """export default function TalentLens() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login"); // login, signup
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); })
      .catch(e => console.error("Auth check failed", e));
  }, []);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    const endpoint = authMode === "login" ? "/auth/login" : "/auth/signup";
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(authForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      setUser(data.user);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (err) {
      setAuthError(err.message);
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
      setUser(null);
    } catch (err) {
      console.error(err);
    }
  }
"""
content = content.replace(talentlens_old, talentlens_new)

# 4. Add AuthModal render block
render_old = """    <>
      <style>{css}</style>
      <div className="app">"""
render_new = """    <>
      <style>{css}</style>
      {!user && (
        <div className="modal-overlay" style={{ zIndex: 1000, background: "#0D1B3E" }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-title">{authMode === "login" ? "Login to TalentLens" : "Create Account"}</div>
            {authError && <div style={{ color: "#C0392B", background: "#FDECEA", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{authError}</div>}
            <form onSubmit={handleAuth}>
              {authMode === "signup" && (
                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input className="form-input" type="text" value={authForm.name} onChange={e => setAuthForm({...authForm, name: e.target.value})} required />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} required minLength={8} />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "12px 16px", marginTop: 10 }}>
                {authMode === "login" ? "Login" : "Sign Up"}
              </button>
            </form>
            <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "#8B929E" }}>
              {authMode === "login" ? (
                <>Don't have an account? <span style={{ color: "#0A7C88", cursor: "pointer", fontWeight: 600 }} onClick={() => {setAuthMode("signup"); setAuthError("");}}>Sign up</span></>
              ) : (
                <>Already have an account? <span style={{ color: "#0A7C88", cursor: "pointer", fontWeight: 600 }} onClick={() => {setAuthMode("login"); setAuthError("");}}>Login</span></>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="app">"""
content = content.replace(render_old, render_new)

# 5. Update Dashboard prop in JSX
page_dashboard_old = '{page === "dashboard" && <Dashboard employees={employees} jobs={jobs} alerts={alerts} />}'
page_dashboard_new = '{page === "dashboard" && <Dashboard employees={employees} jobs={jobs} alerts={alerts} user={user} onLogout={handleLogout} />}'
content = content.replace(page_dashboard_old, page_dashboard_new)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("PATCHED")
