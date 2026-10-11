with open('/Users/milindpius/Documents/talentlens-ui/src/DatasetFilters.jsx', 'r') as f:
    content = f.read()

content = content.replace('background: "#0f1115"', 'background: "#ffffff"')
content = content.replace('color: "var(--text)"', 'color: "#1E2233"')
content = content.replace('color: "var(--text-muted)"', 'color: "#4B5563"')
content = content.replace('borderRight: "1px solid rgba(255,255,255,0.08)"', 'borderRight: "1px solid #E2E6EF"')
content = content.replace('rgba(255,255,255,0.05)', '#F7F8FA')
content = content.replace('rgba(255,255,255,0.1)', '#E2E6EF')
content = content.replace('color: filters.skills.includes(s) ? "#fff" : "var(--text-muted)"', 'color: filters.skills.includes(s) ? "#fff" : "#4B5563"')

with open('/Users/milindpius/Documents/talentlens-ui/src/DatasetFilters.jsx', 'w') as f:
    f.write(content)
