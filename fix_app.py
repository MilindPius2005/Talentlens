import re

with open('backend/app.py', 'r') as f:
    content = f.read()

# 1. auth_signup: remove role logic
content = re.sub(
    r"is_first = mongo_db\['users'\].count_documents\(\{\}\) == 0\n\s*role = 'Admin' if is_first else 'Explorer'",
    "role = 'User'",
    content
)

# 2. remove /admin/make_admin
content = re.sub(
    r"@app\.route\('/admin/make_admin', methods=\['POST', 'OPTIONS'\]\)\ndef auth_make_admin\(\):.*?return jsonify\(\{\"ok\": res\.modified_count > 0\}\)\n\n",
    "",
    content,
    flags=re.DOTALL
)

# 3. softblock_employee logic
def fix_softblock(match):
    body = match.group(1)
    # unindent the body
    body = re.sub(r"^    ", "", body, flags=re.MULTILINE)
    return body

content = re.sub(
    r"    if user\.get\('role'\) == 'Admin':\n(.*?)    else:\n.*?return jsonify\(\{\"ok\": True\}\)\n",
    fix_softblock,
    content,
    flags=re.DOTALL
)

# 4. admin routes
content = re.sub(
    r"@app\.route\('/admin/requests.*?(?=@app\.route)",
    "",
    content,
    flags=re.DOTALL
)

# 5. admin required decorators in sync/clear
content = re.sub(r"\n\s*if not user or user\.get\('role'\) != 'Admin':\n\s*return jsonify\(\{\"error\": \"(?:Unauthorized|Admin required)\"\}\), (?:401|403)", "", content)

# write back
with open('backend/app.py', 'w') as f:
    f.write(content)
print("done")
