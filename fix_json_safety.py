import re

with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

# 1. Add API_BASE and parseJsonSafe right after imports if not present
top_helper = """import DatasetFilters from './DatasetFilters';
import OntologyGraph from './OntologyGraph';

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

async function parseJsonSafe(res) {
  try {
    if (!res) return null;
    const text = await res.text();
    if (!text || !text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}
"""

content = content.replace(
    """import DatasetFilters from './DatasetFilters';
import OntologyGraph from './OntologyGraph';""",
    top_helper
)

# 2. Remove the old duplicate API_BASE definition at line 910
content = content.replace(
    'const API_BASE = import.meta.env.VITE_API_BASE || "/api"; // TalentLens backend base URL',
    '// API_BASE defined at top of file'
)

# 3. Fix line 328 (Employees admin requests)
old_emp_fetch = """      fetch(`${API_BASE}/admin/requests/all`, { credentials: "include" })
        .then(r => r.json())"""
new_emp_fetch = """      fetch(`${API_BASE}/admin/requests/all`, { credentials: "include" })
        .then(r => parseJsonSafe(r))"""
content = content.replace(old_emp_fetch, new_emp_fetch)

# 4. Fix line 1327 (Ingestion uploads)
old_ingest_fetch = """    fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" })
      .then(r => r.json())"""
new_ingest_fetch = """    fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" })
      .then(r => parseJsonSafe(r))"""
content = content.replace(old_ingest_fetch, new_ingest_fetch)

# 5. Fix line 1346 (handleUpload)
old_upload = """      const res = await fetch(`${API_BASE}/ingestion/upload`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      // Refetch history to get the exact real-time dates and values
      const histRes = await fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" });
      if (histRes.ok) {
        setHistory(await histRes.json());
      }"""

new_upload = """      const res = await fetch(`${API_BASE}/ingestion/upload`, {
        method: "POST",
        credentials: "include",
        body: formData
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      // Refetch history to get the exact real-time dates and values
      const histRes = await fetch(`${API_BASE}/ingestion/uploads`, { credentials: "include" });
      if (histRes.ok) {
        const histData = await parseJsonSafe(histRes);
        if (Array.isArray(histData)) setHistory(histData);
      }"""
content = content.replace(old_upload, new_upload)

# 6. Fix handleAction in GraphView
old_graph_action = """      if (res.ok) {
        alert(user.role === 'Admin' ? `Successfully updated to ${action}` : `Requested ${action}. Admin approval pending.`);
        setSelectedNode(null);
      } else {
        const d = await res.json();
        alert(d.error || "Action failed");
      }"""
new_graph_action = """      if (res.ok) {
        alert(user.role === 'Admin' ? `Successfully updated to ${action}` : `Requested ${action}. Admin approval pending.`);
        setSelectedNode(null);
      } else {
        const d = await parseJsonSafe(res);
        alert(d?.error || "Action failed");
      }"""
content = content.replace(old_graph_action, new_graph_action)

# 7. Fix handleFilterChange in GraphView
old_filter_change = """      const res = await fetch(`${API_BASE}/employees?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Filter fetch failed");
      const employees = await res.json();"""
new_filter_change = """      const res = await fetch(`${API_BASE}/employees?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Filter fetch failed");
      const employees = (await parseJsonSafe(res)) || [];"""
content = content.replace(old_filter_change, new_filter_change)

# 8. Fix handleExpand in GraphView
old_expand = """      const res = await fetch(`${API_BASE}/graph/expand/${encodeURIComponent(node.id)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Expand failed");
      const data = await res.json();"""
new_expand = """      const res = await fetch(`${API_BASE}/graph/expand/${encodeURIComponent(node.id)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Expand failed");
      const data = await parseJsonSafe(res);
      if (!data) return;"""
content = content.replace(old_expand, new_expand)

# 9. Fix handleSearch in GraphView
old_search = """      const res = await fetch(`${API_BASE}/employees?search=${encodeURIComponent(query)}`, { credentials: "include" });
      if (res.ok) {
        const employees = await res.json();"""
new_search = """      const res = await fetch(`${API_BASE}/employees?search=${encodeURIComponent(query)}`, { credentials: "include" });
      if (res.ok) {
        const employees = await parseJsonSafe(res);"""
content = content.replace(old_search, new_search)

# 10. Fix AdminRequests
old_admin_req = """    fetch(url, { credentials: "include" })
      .then(r => r.json())"""
new_admin_req = """    fetch(url, { credentials: "include" })
      .then(r => parseJsonSafe(r))"""
content = content.replace(old_admin_req, new_admin_req)

# 11. Fix auth/me
old_auth_me = """    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { if (d.user) setUser(d.user); })"""
new_auth_me = """    fetch(`${API_BASE}/auth/me`, { credentials: "include" })
      .then(r => parseJsonSafe(r))
      .then(d => { if (d && d.user) setUser(d.user); })"""
content = content.replace(old_auth_me, new_auth_me)

# 12. Fix handleAuth
old_handle_auth = """      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");
      setUser(data.user);"""
new_handle_auth = """      const data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data?.error || "Authentication failed");
      if (data && data.user) setUser(data.user);"""
content = content.replace(old_handle_auth, new_handle_auth)

# 13. Fix top-level employees and alerts fetch
old_top_fetch = """      fetch(`${API_BASE}/employees`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setEmployees(data);
        })
        .catch(console.error);
        
      fetch(`${API_BASE}/alerts`, { credentials: "include" })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setAlerts(data);
        })
        .catch(console.error);"""

new_top_fetch = """      fetch(`${API_BASE}/employees`, { credentials: "include" })
        .then(res => parseJsonSafe(res))
        .then(data => {
          if (Array.isArray(data)) setEmployees(data);
        })
        .catch(console.error);
        
      fetch(`${API_BASE}/alerts`, { credentials: "include" })
        .then(res => parseJsonSafe(res))
        .then(data => {
          if (Array.isArray(data)) setAlerts(data);
        })
        .catch(console.error);"""
content = content.replace(old_top_fetch, new_top_fetch)

# 14. Fix background poll so it only polls when logged in and uses parseJsonSafe
old_poll = """  // poll the local FastAPI backend so changes made from another app/script
  // (curl, Postman, a scheduled job, etc.) show up here automatically
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/employees`, { credentials: "include" });
        if (!res.ok) throw new Error("bad response");
        const apiEmployees = await res.json();
        if (cancelled) return;
        setGraphEmployees(prev => prev.map(local => {
          const match = apiEmployees.find(a => a.id === local.id);
          if (!match) return local;
          return {
            ...local,
            status: match.status,
            location: match.location ?? local.location,
            bench_days: match.available_since ? daysSince(match.available_since) : local.bench_days,
            softblock_job: match.softblock_job ?? null,
            softblock_manager: match.softblock_manager ?? null,
            softblock_start: match.softblock_start ?? null,
            softblock_expiry: match.softblock_expiry ?? null,
          };
        }));
        setApiConnected(true);
      } catch (err) {
        setApiConnected(false);
      }
      try {
        const res2 = await fetch(`${API_BASE}/alerts`, { credentials: "include" });
        if (res2.ok) {
          const apiAlerts = await res2.json();
          if (!cancelled) {
            setAlerts(prev => {
              const existingIds = new Set(prev.map(a => a.id));
              const fresh = apiAlerts.filter(a => !existingIds.has(a.id));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
          }
        }
      } catch (err) { /* backend not reachable yet, ignore */ }
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);"""

new_poll = """  // poll the backend so changes made from another app/script show up automatically
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/employees`, { credentials: "include" });
        if (!res.ok) return;
        const apiEmployees = await parseJsonSafe(res);
        if (cancelled || !Array.isArray(apiEmployees)) return;
        setGraphEmployees(prev => prev.map(local => {
          const match = apiEmployees.find(a => a.id === local.id);
          if (!match) return local;
          return {
            ...local,
            status: match.status,
            location: match.location ?? local.location,
            bench_days: match.available_since ? daysSince(match.available_since) : local.bench_days,
            softblock_job: match.softblock_job ?? null,
            softblock_manager: match.softblock_manager ?? null,
            softblock_start: match.softblock_start ?? null,
            softblock_expiry: match.softblock_expiry ?? null,
          };
        }));
        setApiConnected(true);
      } catch (err) {
        setApiConnected(false);
      }
      try {
        const res2 = await fetch(`${API_BASE}/alerts`, { credentials: "include" });
        if (res2.ok) {
          const apiAlerts = await parseJsonSafe(res2);
          if (!cancelled && Array.isArray(apiAlerts)) {
            setAlerts(prev => {
              const existingIds = new Set(prev.map(a => a.id));
              const fresh = apiAlerts.filter(a => !existingIds.has(a.id));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
          }
        }
      } catch (err) { /* backend not reachable yet, ignore */ }
    }
    poll();
    const interval = setInterval(poll, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user]);"""
content = content.replace(old_poll, new_poll)

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)

print("Applied JSON safety patches to TalentLens.tsx successfully")
