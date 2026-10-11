import re

with open('src/TalentLens.tsx', 'r') as f:
    content = f.read()

# 1. Remove Role display in user profile
content = re.sub(
    r"\s*<div><div style={{ fontSize: 11, color: \"#8B929E\" }}>Role</div><div style={{ fontSize: 13, fontWeight: 500, color: user\?\.role === \"Admin\" \? \"#B8710F\" : \"#0A7C88\" }}>{user\?\.role \|\| \"\.\.\.\"}</div></div>",
    "",
    content
)

# 2. Remove pendingRequests state and useEffect
content = re.sub(
    r"\s*const \[pendingRequests, setPendingRequests\] = useState\(\[\]\);\n\n\s*useEffect\(\(\) => \{\n\s*if \(user\?\.role === \"Explorer\"\).*?\}\n\s*\}, \[user\]\);",
    "",
    content,
    flags=re.DOTALL
)

# 3. Simplify executeAction (remove Admin check and just execute)
def fix_execute(match):
    # just return the block that was inside if (user?.role === "Admin")
    block = match.group(1)
    # unindent one level
    block = re.sub(r"^          ", "        ", block, flags=re.MULTILINE)
    return block

content = re.sub(
    r"\s*if \(user\?\.role === \"Admin\"\) \{\n(.*?)        \} else \{\n.*?\}\n",
    r"\n\1\n",
    content,
    flags=re.DOTALL
)

# 4. Remove {user?.role === 'Admin' && ( wrap around Clear Database button
content = re.sub(
    r"\{user\?\.role === 'Admin' && \(\n\s*<button(.*?)>\n\s*Clear Database\n\s*</button>\n\s*\)\}",
    r"<button\1>\n            Clear Database\n          </button>",
    content,
    flags=re.DOTALL
)

# 5. Simplify alert message
content = re.sub(
    r"alert\(user\.role === 'Admin' \? `Successfully updated to \$\{action\}` : `Requested \$\{action\}\. Admin approval pending\.`\);",
    r"alert(`Successfully updated to ${action}`);",
    content
)

# 6. Remove Actions will be sent as a request for Admin approval
content = re.sub(
    r"\s*\{user\?\.role !== 'Admin' && \(\n\s*<div style={{ fontSize: 11, color: \"#8B929E\", textAlign: \"center\", marginTop: 4 }}>\n\s*Actions will be sent as a request for Admin approval\.\n\s*</div>\n\s*\)\}",
    "",
    content
)

# 7. Remove Admin requests from PAGES
content = re.sub(
    r"\s*\{ id:\"admin\", icon:\"🛡️\", label:\"Admin Requests\", adminOnly:true \},",
    "",
    content
)

# 8. Simplify PAGES.filter
content = re.sub(
    r"PAGES\.filter\(p => !p\.adminOnly \|\| user\?\.role === \"Admin\"\)\.map",
    r"PAGES.map",
    content
)

# 9. Remove <AdminRequests />
content = re.sub(
    r"\s*\{page === \"admin\" && <AdminRequests />\}",
    "",
    content
)

with open('src/TalentLens.tsx', 'w') as f:
    f.write(content)
print("done")
