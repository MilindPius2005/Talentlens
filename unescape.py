with open("src/TalentLens.tsx", "r") as f:
    content = f.read()

content = content.replace('\\"', '"')

with open("src/TalentLens.tsx", "w") as f:
    f.write(content)
print("Unescaped")
