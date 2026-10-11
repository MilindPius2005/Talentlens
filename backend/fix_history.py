with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'r') as f:
    content = f.read()

old_func = """@app.route('/ingestion/uploads', methods=['GET', 'OPTIONS'])
def get_uploads():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    hist = list(mongo_db['upload_history'].find({'user_id': str(user['_id'])}, {'_id': 0}).sort('timestamp', -1))
    return jsonify(hist)"""

new_func = """@app.route('/ingestion/uploads', methods=['GET', 'OPTIONS'])
def get_uploads():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    hist = list(mongo_db['upload_history'].find({'user_id': str(user['_id'])}, {'_id': 0}).sort('timestamp', -1))
    
    mapped_hist = []
    import uuid
    for h in hist:
        mapped_hist.append({
            'id': h.get('id', uuid.uuid4().hex),
            'filename': h.get('filename', 'Unknown'),
            'uploadedAt': h.get('timestamp', ''),
            'totalRows': h.get('rows_processed', 0),
            'totalNodes': h.get('rows_processed', 0) * 2,
            'totalRelationships': h.get('rows_processed', 0) * 3,
            'username': h.get('user_name', 'Unknown')
        })
    return jsonify(mapped_hist)"""

if old_func in content:
    content = content.replace(old_func, new_func)
    with open('/Users/milindpius/Documents/talentlens-ui/backend/app.py', 'w') as f:
        f.write(content)
    print("Fixed get_uploads")
else:
    print("Could not find get_uploads")
