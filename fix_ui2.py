import re

with open('src/TalentLens.tsx', 'r') as f:
    content = f.read()

# 1. Remove pendingRequests rendering block
content = re.sub(
    r"\s*\{pendingRequests\.length > 0 && \(\n\s*<div.*?</div>\n\s*\)\}",
    "",
    content,
    flags=re.DOTALL
)

# 2. Fix user?.role === 'Admin' for Clear Database button
content = re.sub(
    r"\s*\{user\?\.role === 'Admin' && \(\n\s*<button(.*?)\n\s*onClick=\{handleClearDatabase\}\n(.*?)>\n\s*Clear Database\n\s*</button>\n\s*\)\}",
    r"\n        <button\1\n            onClick={handleClearDatabase}\n\2>\n            Clear Database\n          </button>",
    content,
    flags=re.DOTALL
)

with open('src/TalentLens.tsx', 'w') as f:
    f.write(content)
print("done")
