with open('/Users/milindpius/Documents/talentlens-ui/src/TalentLens.tsx', 'r') as f:
    content = f.read()

import re

# Replace state initializations
old_state = """  const [employees, setEmployees] = useState(INITIAL_EMPLOYEES);
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [alerts, setAlerts] = useState(INITIAL_ALERTS);
  const [graphEmployees, setGraphEmployees] = useState(EMPLOYEES);"""

new_state = """  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState(INITIAL_JOBS);
  const [alerts, setAlerts] = useState([]);
  const [graphEmployees, setGraphEmployees] = useState([]);"""

content = content.replace(old_state, new_state)

# Add useEffect to fetch employees and alerts when user logs in or page changes
hook = """  // periodic re-check so a running session catches date rollovers too
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);"""

new_hook = """  // periodic re-check so a running session catches date rollovers too
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Fetch employees and alerts from Neo4j backend
  useEffect(() => {
    if (user) {
      fetch(`${API_BASE}/employees`, { credentials: "include" })
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
        .catch(console.error);
    }
  }, [user, page]);"""

content = content.replace(hook, new_hook)

with open('/Users/milindpius/Documents/talentlens-ui/src/TalentLens.tsx', 'w') as f:
    f.write(content)

print("Patched TalentLens state")
