with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if line.strip() == 'return jsonify({"status": "success", "message": "File ingested successfully"})':
        lines[i] = '    return jsonify({"status": "success", "message": "File ingested successfully"})\n'
    if line.strip() == '})' and 'upload_history' in lines[i-6]:
        lines[i] = '    })\n'
    if line.strip().startswith("'user_id': str(user['_id']),"):
        lines[i] = "        'user_id': str(user['_id']),\n"
    if line.strip().startswith("'user_name': user.get('name'),"):
        lines[i] = "        'user_name': user.get('name'),\n"
    if line.strip().startswith("'filename': file.filename,"):
        lines[i] = "        'filename': file.filename,\n"
    if line.strip().startswith("'timestamp': datetime.now().isoformat(),"):
        lines[i] = "        'timestamp': datetime.now().isoformat(),\n"
    if line.strip().startswith("'rows_processed': len(df)"):
        lines[i] = "        'rows_processed': len(df)\n"
        
with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'w') as f:
    f.writelines(lines)
    
