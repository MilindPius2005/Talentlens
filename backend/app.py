import os
import uuid
import pandas as pd
from flask import Flask, request, jsonify
from pymongo import MongoClient
from neo4j import GraphDatabase
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

MONGO_URI = os.getenv('MONGO_URI')
MONGO_DB_NAME = os.getenv('MONGO_DB_NAME', 'talentlens')
mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB_NAME]

NEO4J_URI = os.getenv('NEO4J_URI')
NEO4J_USER = os.getenv('NEO4J_USER')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')
NEO4J_DATABASE = os.getenv('NEO4J_DATABASE', 'neo4j')

SOFTBLOCK_DAYS = 15
REQUIRED_COLUMNS = ['Emp_Name', 'Client_Name', 'Skills', 'misc skill']
NODE_COLUMNS = {'emp_name', 'client_name', 'project', 'skills', 'misc skill', 'module', 'domain', 'skillgroup', 'level', 'kpmg_level', 'location'}

def get_neo4j_driver():
    return GraphDatabase.driver(
        NEO4J_URI,
        auth=(NEO4J_USER, NEO4J_PASSWORD),
        connection_timeout=5,
        max_transaction_retry_time=5
    )

@app.after_request
def after_request(response):
    origin = request.headers.get('Origin', '*')
    response.headers['Access-Control-Allow-Origin'] = origin
    response.headers['Access-Control-Allow-Credentials'] = 'true'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    return response

@app.route('/', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/healthz', methods=['GET'])
def healthz():
    return 'OK'

@app.route('/health/db', methods=['GET'])
def health_db():
    status = {"mongo": False, "neo4j": False}
    try:
        mongo_client.admin.command('ping')
        status['mongo'] = True
    except: pass
    try:
        with get_neo4j_driver() as d:
            d.verify_connectivity()
            status['neo4j'] = True
    except: pass
    return jsonify(status)

def get_current_user():
    session_id = request.cookies.get('oe_session')
    if not session_id: return None
    session = mongo_db['sessions'].find_one({'session_id': session_id})
    if not session: return None
    user = mongo_db['users'].find_one({'_id': session['user_id']})
    return user

def public_user(user):
    if not user: return None
    return {'id': str(user['_id']), 'name': user.get('name'), 'email': user.get('email'), 'role': user.get('role')}

@app.route('/auth/signup', methods=['POST', 'OPTIONS'])
def auth_signup():
    if request.method == 'OPTIONS': return '', 204
    data = request.json
    if not data or not data.get('email') or not data.get('password') or not data.get('name'):
        return jsonify({"error": "Missing fields"}), 400
    
    email = data['email'].strip().lower()
    if mongo_db['users'].find_one({'email': {'$regex': f'^{email}$', '$options': 'i'}}):
        return jsonify({"error": "Email exists"}), 400
        
    role = 'User'
    
    user_id = mongo_db['users'].insert_one({
        'name': data['name'],
        'email': email,
        'passwordHash': generate_password_hash(data['password'], method='pbkdf2:sha256'),
        'role': role
    }).inserted_id
    
    session_id = uuid.uuid4().hex
    mongo_db['sessions'].insert_one({'session_id': session_id, 'user_id': user_id})
    
    user = mongo_db['users'].find_one({'_id': user_id})
    resp = jsonify({"ok": True, "user": public_user(user)})
    resp.set_cookie('oe_session', session_id, httponly=True, samesite='Lax', secure=False, max_age=604800)
    return resp

@app.route('/auth/login', methods=['POST', 'OPTIONS'])
def auth_login():
    if request.method == 'OPTIONS': return '', 204
    data = request.json
    email = data.get('email', '').strip().lower()
    user = mongo_db['users'].find_one({'email': email})
    if not user:
        # Fallback to case-insensitive exact match in case the user was saved with mixed case
        user = mongo_db['users'].find_one({'email': {'$regex': f'^{email}$', '$options': 'i'}})
        
    if not user or not check_password_hash(user['passwordHash'], data.get('password')):
        return jsonify({"error": "Invalid email or password"}), 401
        
    session_id = uuid.uuid4().hex
    mongo_db['sessions'].insert_one({'session_id': session_id, 'user_id': user['_id']})
    
    resp = jsonify({"ok": True, "user": public_user(user)})
    resp.set_cookie('oe_session', session_id, httponly=True, samesite='Lax', secure=False, max_age=604800)
    return resp

@app.route('/auth/me', methods=['GET'])
def auth_me():
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"user": public_user(user)})

@app.route('/auth/logout', methods=['POST', 'OPTIONS'])
def auth_logout():
    if request.method == 'OPTIONS': return '', 204
    session_id = request.cookies.get('oe_session')
    if session_id:
        mongo_db['sessions'].delete_many({'session_id': session_id})
    resp = jsonify({"ok": True})
    resp.set_cookie('oe_session', '', expires=0)
    return resp

def get_pending_queue_data():
    """Read all queued ingestion records from MongoDB and aggregate them by field type."""
    result = {'skills': set(), 'clients': set(), 'locations': set(), 'domains': set(), 'levels': set(), 'employees': []}
    try:
        for job in mongo_db['pending_neo4j_queue'].find({}, {'records': 1, 'today': 1}):
            for rec in job.get('records', []):
                for sk in rec.get('skills', []) + rec.get('misc_skills', []):
                    if sk: result['skills'].add(sk)
                cn = rec.get('client_name')
                if cn and cn not in ('nan', '', 'None'): result['clients'].add(cn)
                
                loc = rec.get('location')
                if loc:
                    if isinstance(loc, str): result['locations'].add(loc)
                    else: 
                        for l in loc: 
                            if l: result['locations'].add(l)
                            
                dom = rec.get('domain')
                if dom:
                    if isinstance(dom, str): result['domains'].add(dom)
                    else:
                        for d in dom:
                            if d: result['domains'].add(d)
                            
                lvl = rec.get('level')
                if lvl:
                    if isinstance(lvl, str): result['levels'].add(lvl)
                    else:
                        for l in lvl:
                            if l: result['levels'].add(l)
                            
                avail_date = rec.get('available_since') or job.get('today', datetime.now(timezone.utc).strftime('%Y-%m-%d'))
                result['employees'].append({'rec': rec, 'ingested_date': avail_date})
    except Exception as e:
        print(f"get_pending_queue_data error: {e}")
    return result

@app.route('/filter-options', methods=['GET', 'OPTIONS'])
def get_filter_options():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    
    options = {
        'clients': [], 'locations': [], 'domains': [], 'skills': [], 'levels': [],
        'benchMin': 0, 'benchMax': 0
    }
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                res = session.run("MATCH (s:Skill) RETURN DISTINCT s.name as name")
                options['skills'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (c:Client) RETURN DISTINCT c.name as name")
                options['clients'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (l:Location) RETURN DISTINCT l.name as name")
                options['locations'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (d:Domain) RETURN DISTINCT d.name as name")
                options['domains'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (d:Level) RETURN DISTINCT d.name as name")
                options['levels'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (e:Employee) WHERE e.available_since IS NOT NULL RETURN min(e.available_since) as oldest")
                record = res.single()
                if record and record['oldest']:
                    oldest_date = datetime.strptime(record['oldest'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                    options['benchMax'] = (datetime.now(timezone.utc) - oldest_date).days
                else:
                    options['benchMax'] = 365
    except Exception as e:
        print(f"Error fetching filter options from Neo4j: {e}")

    # Merge data from pending MongoDB queue (works even when Neo4j is offline)
    pending = get_pending_queue_data()
    options['skills'] = sorted(set(options['skills']) | pending['skills'])
    options['clients'] = sorted(set(options['clients']) | pending['clients'])
    options['locations'] = sorted(set(options['locations']) | pending['locations'])
    options['domains'] = sorted(set(options['domains']) | pending['domains'])
    options['levels'] = sorted(set(options['levels']) | pending['levels'])
    if not options['benchMax']:
        options['benchMax'] = 365
    return jsonify(options)

@app.route('/employees', methods=['GET'])
def get_employees():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    bench_min = request.args.get('benchMin', type=int)
    bench_max = request.args.get('benchMax', type=int)
    client = request.args.get('client')
    location = request.args.get('location')
    domain = request.args.get('domain')
    status = request.args.get('status')
    level = request.args.get('level')
    skills = request.args.get('skills')
    search = request.args.get('search')
    
    match_clauses = ["MATCH (e:Employee)"]
    where_clauses = []
    params = {}
    
    if client:
        match_clauses.append("MATCH (e)-[:WORKED_FOR]->(:Client {name: $client})")
        params['client'] = client
    if location:
        match_clauses.append("MATCH (e)-[:HAS_LOCATION]->(:Location {name: $location})")
        params['location'] = location
    if domain:
        match_clauses.append("MATCH (e)-[:HAS_DOMAIN]->(:Domain {name: $domain})")
        params['domain'] = domain
    if level:
        match_clauses.append("MATCH (e)-[:HAS_LEVEL]->(:Level {name: $level})")
        params['level'] = level
    if status:
        where_clauses.append("e.status = $status")
        params['status'] = status.upper()
    if search:
        where_clauses.append("toLower(e.name) CONTAINS toLower($search)")
        params['search'] = search
        
    if skills:
        skill_list = [s.strip() for s in skills.split(',')]
        for i, sk in enumerate(skill_list):
            match_clauses.append(f"MATCH (e)-[:HAS_SKILL|HAS_MISC_SKILL]->(:Skill {{name: $skill_{i}}})")
            params[f'skill_{i}'] = sk
            
    query = "\n".join(match_clauses)
    if where_clauses:
        query += "\nWHERE " + " AND ".join(where_clauses)
    query += "\nRETURN e"
    
    employees = []
    seen_names = set()
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                result = session.run(query, **params)
                today = datetime.now(timezone.utc)
                for record in result:
                    node = record['e']
                    emp = dict(node)
                    
                    bench_days = 0
                    if emp.get('available_since'):
                        try:
                            avail = datetime.strptime(emp['available_since'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                            bench_days = (today - avail).days
                        except: pass
                    
                    if bench_min is not None and bench_days < bench_min: continue
                    if bench_max is not None and bench_days > bench_max: continue
                        
                    id_val = emp.get('id', emp.get('name'))
                    seen_names.add(emp.get('name', '').lower())
                    employees.append({
                        'id': id_val,
                        'name': emp.get('name'),
                        'status': emp.get('status', 'AVAILABLE'),
                        'available_since': emp.get('available_since'),
                        'bench_aging': bench_days,
                        'location': emp.get('location'),
                        'skills': emp.get('skills', []),
                        'softblock_job': emp.get('softblock_job'),
                        'softblock_manager': emp.get('softblock_manager'),
                        'softblock_start': emp.get('softblock_start'),
                        'softblock_expiry': emp.get('softblock_expiry'),
                        'interviews': emp.get('interviews', [])
                    })
    except Exception as e:
        print(f"Error querying Neo4j: {e}")

    # Merge employees from pending MongoDB queue (works even when Neo4j is offline)
    try:
        today = datetime.now(timezone.utc)
        today_str = today.strftime('%Y-%m-%d')
        skill_filter = [s.strip() for s in skills.split(',')] if skills else []

        for job in mongo_db['pending_neo4j_queue'].find({}, {'records': 1, 'today': 1}):
            for rec in job.get('records', []):
                emp_name = rec.get('emp_name', '')
                if not emp_name or emp_name.lower() in seen_names:
                    continue

                all_skills = rec.get('skills', []) + rec.get('misc_skills', [])
                if client and rec.get('client_name') != client: continue
                if location and location not in rec.get('location', []): continue
                if domain and domain not in rec.get('domain', []): continue
                if level and level not in rec.get('level', []): continue
                if status and status.upper() != 'AVAILABLE': continue
                if search and search.lower() not in emp_name.lower(): continue
                if skill_filter and not any(sk in all_skills for sk in skill_filter): continue

                avail_date_str = rec.get('available_since') or job.get('today', today_str)
                bench_days = 0
                try:
                    avail = datetime.strptime(avail_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                    bench_days = (today - avail).days
                except: pass

                if bench_min is not None and bench_days < bench_min: continue
                if bench_max is not None and bench_days > bench_max: continue

                seen_names.add(emp_name.lower())
                employees.append({
                    'id': emp_name,
                    'name': emp_name,
                    'status': 'AVAILABLE',
                    'available_since': avail_date_str,
                    'bench_aging': bench_days,
                    'location': rec.get('location', [None])[0] if rec.get('location') else None,
                    'skills': all_skills,
                    'softblock_job': None,
                    'softblock_manager': None,
                    'softblock_start': None,
                    'softblock_expiry': None,
                    'interviews': [],
                    'neo4j_pending': True
                })
    except Exception as e:
        print(f"Error reading pending queue for employees: {e}")

    return jsonify(employees)

@app.route('/employees/<emp_id>/softblock', methods=['POST', 'OPTIONS'])
def softblock_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    
    job_label = data.get('job_label') or data.get('job_id') or 'Opportunity'
    manager_name = data.get('manager_name') or user.get('name') or 'Admin'
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    expiry = (datetime.now(timezone.utc) + timedelta(days=SOFTBLOCK_DAYS)).strftime('%Y-%m-%d')
    
    emp_name = emp_id
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                res = session.run(
                    "MATCH (e:Employee) WHERE e.name = $emp_id OR e.id = $emp_id SET e.status = 'SOFTBLOCKED', e.softblock_job = $job, e.softblock_manager = $manager, e.softblock_start = $start, e.softblock_expiry = $expiry RETURN e.name AS name",
                    emp_id=emp_id, job=job_label, manager=manager_name, start=today, expiry=expiry
                )
                rec = res.single()
                if rec and rec['name']:
                    emp_name = rec['name']
    except Exception as e:
        print(f"Neo4j softblock error: {e}")

    try:
        mongo_db['pending_neo4j_queue'].update_many(
            {"records.Emp_Name": emp_id},
            {"$set": {"records.$.status": "SOFTBLOCKED", "records.$.softblock_job": job_label, "records.$.softblock_manager": manager_name, "records.$.softblock_start": today, "records.$.softblock_expiry": expiry}}
        )
    except Exception:
        pass

    alert_doc = {
        'id': f"SB-{uuid.uuid4().hex[:8]}",
        'type': 'SOFTBLOCK',
        'employee': emp_name,
        'employee_id': emp_id,
        'job_description': job_label,
        'softblocked_by': manager_name,
        'expiry_date': expiry,
        'sent_at': today,
        'recipient': 'hr@company.com'
    }
    mongo_db['alerts'].insert_one(alert_doc)
    return jsonify({"ok": True, "alert": {k: v for k, v in alert_doc.items() if k != '_id'}})

@app.route('/employees/<emp_id>/release', methods=['POST', 'OPTIONS'])
def release_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    emp_name = emp_id
    released_from = 'Previous Opportunity'
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                res = session.run("MATCH (e:Employee) WHERE e.name = $emp_id OR e.id = $emp_id RETURN e.name AS name, e.softblock_job AS job", emp_id=emp_id)
                rec = res.single()
                if rec:
                    if rec.get('name'): emp_name = rec['name']
                    if rec.get('job'): released_from = rec['job']
                session.run("MATCH (e:Employee) WHERE e.name = $emp_id OR e.id = $emp_id SET e.status = 'AVAILABLE', e.softblock_job = null, e.softblock_manager = null, e.softblock_start = null, e.softblock_expiry = null", emp_id=emp_id)
    except Exception as e:
        print(f"Neo4j release error: {e}")

    try:
        mongo_db['pending_neo4j_queue'].update_many(
            {"records.Emp_Name": emp_id},
            {"$set": {"records.$.status": "AVAILABLE", "records.$.softblock_job": None, "records.$.softblock_manager": None, "records.$.softblock_start": None, "records.$.softblock_expiry": None}}
        )
    except Exception:
        pass

    alert_doc = {
        'id': f"REL-{uuid.uuid4().hex[:8]}",
        'type': 'RELEASE',
        'employee': emp_name,
        'employee_id': emp_id,
        'job_description': released_from,
        'sent_at': today,
        'recipient': 'hr@company.com'
    }
    mongo_db['alerts'].insert_one(alert_doc)
    return jsonify({"ok": True, "alert": {k: v for k, v in alert_doc.items() if k != '_id'}})

@app.route('/employees/<emp_id>/snooze', methods=['POST', 'OPTIONS'])
def snooze_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    expiry = (datetime.now(timezone.utc) + timedelta(days=SOFTBLOCK_DAYS)).strftime('%Y-%m-%d')
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                session.run("MATCH (e:Employee) WHERE e.name = $emp_id OR e.id = $emp_id SET e.softblock_expiry = $expiry", emp_id=emp_id, expiry=expiry)
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/jobs', methods=['POST', 'OPTIONS'])
def add_job():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    
    data = request.json
    job_id = data.get('id')
    role = data.get('role', '')
    client = data.get('client', '')
    location = data.get('location', '')
    status = data.get('status', 'OPEN')
    description = data.get('description', '')
    
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                session.run("""
                    MERGE (j:Job {id: $job_id})
                    SET j.role = $role, j.status = $status, j.description = $description, j.name = $role
                    WITH j
                    WHERE $client <> ''
                    MERGE (c:Client {name: $client})
                    MERGE (j)-[:FOR_CLIENT]->(c)
                """, job_id=job_id, role=role, status=status, description=description, client=client)
                
                if location:
                    session.run("""
                        MATCH (j:Job {id: $job_id})
                        MERGE (l:Location {name: $location})
                        MERGE (j)-[:IN_LOCATION]->(l)
                    """, job_id=job_id, location=location)
                
                # We could add required skills here if we wanted, but not strictly necessary for client filter 
                # unless they want jobs to show up in skill filters.
                # Just store them as properties or relationships.
                
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Error adding job to Neo4j: {e}")
        if client:
            mongo_db['pending_neo4j_queue'].insert_one({
                'type': 'job',
                'records': [{
                    'client_name': client,
                    'job_role': role,
                    'location': location
                }]
            })
        return jsonify({"status": "success", "neo4j_pending": True})

@app.route('/alerts', methods=['GET'])
def get_alerts():
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    alerts = []
    today = datetime.now(timezone.utc)
    today_str = today.strftime('%Y-%m-%d')
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                # 1. Bench aging alerts
                res = session.run("MATCH (e:Employee) WHERE e.status <> 'MAPPED' AND e.available_since IS NOT NULL RETURN e.id AS id, e.name AS name, e.available_since AS avail")
                for r in res:
                    try:
                        a_date = datetime.strptime(r['avail'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                        days = (today - a_date).days
                        if days >= 45: alerts.append({'id': f"A45-{r['name']}", 'type': 'BENCH', 'threshold': 45, 'bench_age': days, 'employee': r['name'], 'employee_id': r['name'], 'sent_at': today_str, 'recipient': 'hr@company.com'})
                        elif days >= 30: alerts.append({'id': f"A30-{r['name']}", 'type': 'BENCH', 'threshold': 30, 'bench_age': days, 'employee': r['name'], 'employee_id': r['name'], 'sent_at': today_str, 'recipient': 'hr@company.com'})
                    except: pass

                # 2. All SOFTBLOCKED employees in graph
                res = session.run("MATCH (e:Employee) WHERE e.status = 'SOFTBLOCKED' RETURN e.id AS id, e.name AS name, e.softblock_expiry AS exp, e.softblock_job AS job, e.softblock_manager AS manager, e.softblock_start AS start")
                for r in res:
                    try:
                        exp_str = r.get('exp')
                        is_expired = False
                        if exp_str:
                            e_date = datetime.strptime(exp_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                            if today > e_date:
                                is_expired = True
                        if is_expired:
                            alerts.append({
                                'id': f"EXP-{r['name']}",
                                'type': 'SOFTBLOCK_EXPIRY',
                                'employee': r['name'],
                                'employee_id': r.get('id') or r['name'],
                                'job_description': r.get('job') or 'Opportunity',
                                'softblocked_by': r.get('manager') or 'Manager',
                                'expiry_date': exp_str,
                                'sent_at': today_str,
                                'recipient': 'hr@company.com'
                            })
                        else:
                            alerts.append({
                                'id': f"SB-{r['name']}",
                                'type': 'SOFTBLOCK',
                                'employee': r['name'],
                                'employee_id': r.get('id') or r['name'],
                                'job_description': r.get('job') or 'Opportunity',
                                'softblocked_by': r.get('manager') or 'Manager',
                                'expiry_date': exp_str,
                                'sent_at': r.get('start') or today_str,
                                'recipient': 'hr@company.com'
                            })
                    except: pass
    except: pass

    # Also fallback to pending queue for SOFTBLOCKED employees if neo4j was offline
    try:
        for job in mongo_db['pending_neo4j_queue'].find({}, {'records': 1, 'today': 1}):
            for rec in job.get('records', []):
                if rec.get('status') == 'SOFTBLOCKED':
                    emp_name = rec.get('Emp_Name') or rec.get('name')
                    if emp_name and not any(a.get('employee') == emp_name and a.get('type') == 'SOFTBLOCK' for a in alerts):
                        alerts.append({
                            'id': f"SB-{emp_name}",
                            'type': 'SOFTBLOCK',
                            'employee': emp_name,
                            'employee_id': emp_name,
                            'job_description': rec.get('softblock_job') or 'Opportunity',
                            'softblocked_by': rec.get('softblock_manager') or 'Manager',
                            'expiry_date': rec.get('softblock_expiry'),
                            'sent_at': rec.get('softblock_start') or today_str,
                            'recipient': 'hr@company.com'
                        })
    except: pass

    # Persisted alerts from MongoDB
    mongo_alerts = list(mongo_db['alerts'].find({}, {'_id': 0}))

    # Merge avoiding duplicate employee+type or id
    merged = []
    seen = set()
    for a in alerts:
        key = a.get('id') or f"{a.get('type')}-{a.get('employee')}"
        if key not in seen:
            merged.append(a)
            seen.add(key)

    for ma in mongo_alerts:
        key = ma.get('id') or f"{ma.get('type')}-{ma.get('employee')}"
        emp_key = f"{ma.get('type')}-{ma.get('employee')}"
        if key not in seen and emp_key not in seen:
            merged.append(ma)
            seen.add(key)
            seen.add(emp_key)

    return jsonify(merged)

@app.route('/alerts/clear', methods=['POST', 'OPTIONS'])
def clear_alerts():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    mongo_db['alerts'].delete_many({})
    return jsonify({"ok": True, "message": "All alerts cleared"})


@app.route('/search', methods=['GET', 'OPTIONS'])
@app.route('/graph/search', methods=['GET', 'OPTIONS'])
def search_ontology():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])

    results = []
    seen = set()
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                res = session.run("""
                    MATCH (e:Employee)
                    WHERE toLower(e.name) CONTAINS toLower($q)
                    RETURN e.name AS name, labels(e) AS labels, e.status AS status
                    LIMIT 10
                """, q=q)
                for r in res:
                    name = r['name']
                    if name not in seen:
                        seen.add(name)
                        results.append({
                            'id': name,
                            'label': name,
                            'type': 'Employee',
                            'subtext': 'Select to generate graph'
                        })
                
                res2 = session.run("""
                    MATCH (n)
                    WHERE NOT n:Employee AND toLower(n.name) CONTAINS toLower($q)
                    RETURN n.name AS name, labels(n) AS labels
                    LIMIT 10
                """, q=q)
                for r in res2:
                    name = r['name']
                    if name not in seen:
                        seen.add(name)
                        lbl = list(r['labels'])[0] if r['labels'] else 'Node'
                        results.append({
                            'id': name,
                            'label': name,
                            'type': lbl,
                            'subtext': f"Original: {name}"
                        })
    except Exception as e:
        print(f"Search Neo4j error: {e}")

    # Also search pending MongoDB queue (ingested but Neo4j offline)
    low_q = q.lower()
    try:
        for job in mongo_db['pending_neo4j_queue'].find({}, {'records': 1}):
            for rec in job.get('records', []):
                name = rec.get('emp_name', '')
                if name and low_q in name.lower() and name not in seen:
                    seen.add(name)
                    results.append({
                        'id': name,
                        'label': name,
                        'type': 'Employee',
                        'subtext': 'Select to generate graph'
                    })
    except Exception as e:
        print(f"Pending queue search error: {e}")

    return jsonify(results)

@app.route('/expand/<path:node>', methods=['GET', 'OPTIONS'])
@app.route('/graph/expand/<path:node>', methods=['GET', 'OPTIONS'])
def expand_node(node):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    nodes, links = [], []
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                root_res = session.run("MATCH (n {name: $node}) RETURN n", node=node)
                root_rec = root_res.single()
                if root_rec:
                    rn = root_rec['n']
                    rn_id = rn.get('id', rn.get('name'))
                    nodes.append({'id': rn_id, 'label': rn.get('name'), 'type': list(rn.labels)[0] if rn.labels else 'Node'})

                res = session.run("MATCH (n {name: $node})-[r]-(m) RETURN n, r, m", node=node)
                for rec in res:
                    n = rec['n']; m = rec['m']; r = rec['r']
                    n_id = n.get('id', n.get('name'))
                    m_id = m.get('id', m.get('name'))
                    if not any(d['id'] == n_id for d in nodes): nodes.append({'id': n_id, 'label': n.get('name'), 'type': list(n.labels)[0] if n.labels else 'Node'})
                    if not any(d['id'] == m_id for d in nodes): nodes.append({'id': m_id, 'label': m.get('name'), 'type': list(m.labels)[0] if m.labels else 'Node'})
                    links.append({'source': n_id if r.nodes[0] == n else m_id, 'target': m_id if r.nodes[0] == n else n_id, 'type': r.type})
    except Exception as e:
        print(f"Expand Neo4j error: {e}")

    # Fallback to pending MongoDB queue if still no nodes (ingested but Neo4j offline)
    if not nodes:
        try:
            node_lower = node.lower()
            def add_n(n_id, n_type):
                if not any(n['id'] == n_id for n in nodes):
                    nodes.append({'id': n_id, 'label': n_id, 'type': n_type})
            def add_l(src, tgt, rel):
                if not any((l['source'] == src and l['target'] == tgt and l['type'] == rel) for l in links):
                    links.append({'source': src, 'target': tgt, 'type': rel})

            for job in mongo_db['pending_neo4j_queue'].find({}, {'records': 1}):
                for rec in job.get('records', []):
                    emp_name = rec.get('emp_name', '')
                    client_name = rec.get('client_name', '')
                    skills = rec.get('skills', [])
                    misc_skills = rec.get('misc_skills', [])
                    domains = rec.get('domain', [])
                    locations = rec.get('location', [])
                    levels = rec.get('level', [])
                    
                    if emp_name and emp_name.lower() == node_lower:
                        add_n(emp_name, 'Employee')
                        if client_name and client_name not in ('nan', '', 'None'):
                            add_n(client_name, 'Client')
                            add_l(emp_name, client_name, 'WORKED_FOR')
                        for sk in skills:
                            if sk: add_n(sk, 'Skill'); add_l(emp_name, sk, 'HAS_SKILL')
                        for sk in misc_skills:
                            if sk: add_n(sk, 'Skill'); add_l(emp_name, sk, 'HAS_MISC_SKILL')
                        for dom in domains:
                            if dom: add_n(dom, 'Domain'); add_l(emp_name, dom, 'HAS_DOMAIN')
                        for loc in locations:
                            if loc: add_n(loc, 'Location'); add_l(emp_name, loc, 'HAS_LOCATION')
                        for lvl in levels:
                            if lvl: add_n(lvl, 'Level'); add_l(emp_name, lvl, 'HAS_LEVEL')
                    
                    elif client_name and client_name.lower() == node_lower:
                        add_n(client_name, 'Client')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, client_name, 'WORKED_FOR')
                        
                    elif any(s and s.lower() == node_lower for s in skills):
                        matched = next(s for s in skills if s.lower() == node_lower)
                        add_n(matched, 'Skill')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, matched, 'HAS_SKILL')
                        
                    elif any(s and s.lower() == node_lower for s in misc_skills):
                        matched = next(s for s in misc_skills if s.lower() == node_lower)
                        add_n(matched, 'Skill')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, matched, 'HAS_MISC_SKILL')
                        
                    elif any(d and d.lower() == node_lower for d in domains):
                        matched = next(d for d in domains if d.lower() == node_lower)
                        add_n(matched, 'Domain')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, matched, 'HAS_DOMAIN')
                        
                    elif any(l and l.lower() == node_lower for l in locations):
                        matched = next(l for l in locations if l.lower() == node_lower)
                        add_n(matched, 'Location')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, matched, 'HAS_LOCATION')
                        
                    elif any(l and l.lower() == node_lower for l in levels):
                        matched = next(l for l in levels if l.lower() == node_lower)
                        add_n(matched, 'Level')
                        add_n(emp_name, 'Employee')
                        add_l(emp_name, matched, 'HAS_LEVEL')
        except Exception as e:
            print(f"Pending queue expand error: {e}")

    return jsonify({'nodes': nodes, 'links': links})

def parse_skills(s):
    if not s or pd.isna(s): return []
    return [x.strip() for x in str(s).replace(';', ',').split(',') if x.strip()]

@app.route('/ingestion/upload', methods=['POST', 'OPTIONS'])
def upload_file():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    if 'file' not in request.files: return jsonify({"error": "No file uploaded"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No file selected"}), 400
    try:
        if file.filename.endswith('.csv'): df = pd.read_csv(file)
        elif file.filename.endswith(('.xls', '.xlsx')): df = pd.read_excel(file)
        elif file.filename.endswith('.json'):
            import json; data = json.loads(file.read())
            df = pd.DataFrame([data] if isinstance(data, dict) else data)
        else: return jsonify({"error": "Unsupported file format"}), 400
    except Exception as e: return jsonify({"error": f"File parsing failed: {str(e)}"}), 400
    
    df.columns = df.columns.str.strip()
    df.dropna(how='all', inplace=True)
    if df.empty: return jsonify({"error": "File is empty"}), 400
    
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing: return jsonify({"error": f"Missing required columns: {missing}"}), 422
    
    owner = user.get('name', 'unknown')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    records = []
    
    for _, row in df.iterrows():
        ename = str(row['Emp_Name']).strip()
        if not ename or ename == 'nan': continue
        
        # Parse bench aging from uploaded data
        bench_aging_days = 0
        for bench_col in ['Bench_Aging', 'bench_aging', 'Bench Aging', 'bench aging', 'BenchAging', 'Bench_aging', 'bench_Aging', 'Days_on_Bench', 'days_on_bench', 'bench ageing', 'Bench Ageing', 'bench_ageing', 'Bench_Ageing']:
            if bench_col in df.columns and not pd.isna(row.get(bench_col)):
                try:
                    bench_aging_days = int(float(str(row[bench_col]).strip()))
                    break
                except (ValueError, TypeError):
                    pass
        
        # Calculate available_since from bench aging (today - bench_days)
        if bench_aging_days > 0:
            avail_date = datetime.now(timezone.utc) - timedelta(days=bench_aging_days)
            emp_available_since = avail_date.strftime('%Y-%m-%d')
        else:
            emp_available_since = today
        
        rec = {
            'emp_name': ename,
            'client_name': str(row.get('Client_Name')).strip() if not pd.isna(row.get('Client_Name')) else None,
            'skills': parse_skills(row.get('Skills')),
            'misc_skills': parse_skills(row.get('misc skill')),
            'domain': parse_skills(row.get('Domain')) if 'Domain' in df.columns else [],
            'location': parse_skills(row.get('Location')) if 'Location' in df.columns else [],
            'level': [],
            'available_since': emp_available_since
        }
        for lvl_col in ['Level', 'KPMG_Level']:
            if lvl_col in df.columns and not pd.isna(row.get(lvl_col)):
                rec['level'].extend(parse_skills(row.get(lvl_col)))
        records.append(rec)
        
    if not records: return jsonify({"error": "No valid employee records found"}), 400

    neo4j_synced = False
    neo4j_error = None
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                session.run("UNWIND $records AS rec MERGE (e:Employee {name: rec.emp_name}) ON CREATE SET e.owner = $owner, e.status = 'AVAILABLE', e.available_since = rec.available_since ON MATCH SET e.owner = $owner, e.available_since = rec.available_since", records=records, owner=owner)
                session.run("UNWIND $records AS rec WITH rec WHERE rec.client_name IS NOT NULL AND rec.client_name <> '' AND rec.client_name <> 'nan' MATCH (e:Employee {name: rec.emp_name}) MERGE (c:Client {name: rec.client_name}) ON CREATE SET c.owner = $owner MERGE (e)-[:WORKED_FOR]->(c)", records=records, owner=owner)
                session.run("UNWIND $records AS rec UNWIND rec.skills AS skill WITH rec, skill WHERE skill <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (s:Skill {name: skill}) ON CREATE SET s.owner = $owner MERGE (e)-[:HAS_SKILL]->(s)", records=records, owner=owner)
                session.run("UNWIND $records AS rec UNWIND rec.misc_skills AS skill WITH rec, skill WHERE skill <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (s:Skill {name: skill}) ON CREATE SET s.owner = $owner MERGE (e)-[:HAS_MISC_SKILL]->(s)", records=records, owner=owner)
                session.run("UNWIND $records AS rec UNWIND rec.domain AS d WITH rec, d WHERE d <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (dom:Domain {name: d}) MERGE (e)-[:HAS_DOMAIN]->(dom)", records=records)
                session.run("UNWIND $records AS rec UNWIND rec.location AS l WITH rec, l WHERE l <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (loc:Location {name: l}) MERGE (e)-[:HAS_LOCATION]->(loc)", records=records)
                session.run("UNWIND $records AS rec UNWIND rec.level AS l WITH rec, l WHERE l <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (lvl:Level {name: l}) MERGE (e)-[:HAS_LEVEL]->(lvl)", records=records)
                neo4j_synced = True
    except Exception as e:
        neo4j_error = str(e)
        print(f"Neo4j ingestion failed (will queue): {e}")
        # Store records in pending queue so they can be synced when Neo4j comes back
        mongo_db['pending_neo4j_queue'].insert_one({
            'filename': file.filename,
            'owner': owner,
            'today': today,
            'records': records,
            'queued_at': datetime.now(timezone.utc).isoformat(),
            'user_id': str(user['_id'])
        })

    mongo_db['upload_history'].insert_one({
        'user_id': str(user['_id']), 'user_name': user.get('name'), 'filename': file.filename,
        'timestamp': datetime.now(timezone.utc).isoformat(), 'rows_processed': len(records),
        'neo4j_synced': neo4j_synced
    })

    if neo4j_synced:
        return jsonify({"status": "success", "message": f"File ingested successfully. {len(records)} records added to knowledge graph."})
    else:
        return jsonify({"status": "success", "message": f"File uploaded successfully. {len(records)} records queued (knowledge graph sync pending — Neo4j temporarily unavailable).", "neo4j_pending": True})

@app.route('/ingestion/uploads', methods=['GET', 'OPTIONS'])
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
            'username': h.get('user_name', 'Unknown'),
            'neo4j_synced': h.get('neo4j_synced', True)
        })
    return jsonify(mapped_hist)

@app.route('/ingestion/sync-pending', methods=['POST', 'OPTIONS'])
def sync_pending_neo4j():
    """Retry queued records into Neo4j when it comes back online."""
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()

    pending = list(mongo_db['pending_neo4j_queue'].find({}))
    if not pending:
        return jsonify({"message": "No pending records to sync"})

    synced = 0
    errors = []
    try:
        with get_neo4j_driver() as driver:
            for job in pending:
                try:
                    records = job['records']
                    owner = job['owner']
                    with driver.session(database=NEO4J_DATABASE) as session:
                        session.run("UNWIND $records AS rec MERGE (e:Employee {name: rec.emp_name}) ON CREATE SET e.owner = $owner, e.status = 'AVAILABLE', e.available_since = rec.available_since ON MATCH SET e.owner = $owner, e.available_since = rec.available_since", records=records, owner=owner)
                        session.run("UNWIND $records AS rec WITH rec WHERE rec.client_name IS NOT NULL AND rec.client_name <> '' AND rec.client_name <> 'nan' MATCH (e:Employee {name: rec.emp_name}) MERGE (c:Client {name: rec.client_name}) ON CREATE SET c.owner = $owner MERGE (e)-[:WORKED_FOR]->(c)", records=records, owner=owner)
                        session.run("UNWIND $records AS rec UNWIND rec.skills AS skill WITH rec, skill WHERE skill <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (s:Skill {name: skill}) ON CREATE SET s.owner = $owner MERGE (e)-[:HAS_SKILL]->(s)", records=records, owner=owner)
                        session.run("UNWIND $records AS rec UNWIND rec.misc_skills AS skill WITH rec, skill WHERE skill <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (s:Skill {name: skill}) ON CREATE SET s.owner = $owner MERGE (e)-[:HAS_MISC_SKILL]->(s)", records=records, owner=owner)
                        session.run("UNWIND $records AS rec UNWIND rec.domain AS d WITH rec, d WHERE d <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (dom:Domain {name: d}) MERGE (e)-[:HAS_DOMAIN]->(dom)", records=records)
                        session.run("UNWIND $records AS rec UNWIND rec.location AS l WITH rec, l WHERE l <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (loc:Location {name: l}) MERGE (e)-[:HAS_LOCATION]->(loc)", records=records)
                        session.run("UNWIND $records AS rec UNWIND rec.level AS l WITH rec, l WHERE l <> '' MATCH (e:Employee {name: rec.emp_name}) MERGE (lvl:Level {name: l}) MERGE (e)-[:HAS_LEVEL]->(lvl)", records=records)
                    mongo_db['pending_neo4j_queue'].delete_one({'_id': job['_id']})
                    # Mark upload history as synced
                    mongo_db['upload_history'].update_one(
                        {'user_id': job['user_id'], 'filename': job['filename']},
                        {'$set': {'neo4j_synced': True}}
                    )
                    synced += 1
                except Exception as je:
                    errors.append(str(je))
    except Exception as e:
        return jsonify({"error": f"Neo4j still unreachable: {str(e)}"}), 503

    return jsonify({"synced": synced, "errors": errors, "message": f"Synced {synced} jobs to Neo4j"})

@app.route('/ingestion/clear', methods=['POST', 'OPTIONS'])
def clear_database():
    """Clear upload history, pending queue, and Neo4j database."""
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()

    try:
        mongo_db['upload_history'].delete_many({})
        mongo_db['pending_neo4j_queue'].delete_many({})

        neo4j_cleared = False
        try:
            with get_neo4j_driver() as driver:
                with driver.session(database=NEO4J_DATABASE) as session:
                    session.run("MATCH (e:Employee) DETACH DELETE e")
                    session.run("MATCH (n) WHERE NOT (n)--() AND NOT n:Job DETACH DELETE n")
            neo4j_cleared = True
        except Exception as e:
            print(f"Neo4j clear failed: {e}")

        return jsonify({"status": "success", "message": "Database cleared successfully." if neo4j_cleared else "MongoDB cleared, but Neo4j is offline."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=8000)
