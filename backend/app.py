import os
import uuid
import re
from io import BytesIO
import pandas as pd
from flask import Flask, request, jsonify
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from neo4j import GraphDatabase
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from gridfs import GridFS

if __package__:
    from .employee_store import (LIST_FIELDS, save_import, find_employee, update_employee,
                                 sync_employees, public_employee, repair_softblocked_deployment_status)
else:
    from employee_store import (LIST_FIELDS, save_import, find_employee, update_employee,
                                sync_employees, public_employee, repair_softblocked_deployment_status)

load_dotenv()

app = Flask(__name__)

MONGO_URI = os.getenv('MONGO_URI')
MONGO_DB_NAME = os.getenv('MONGO_DB_NAME', 'talentlens')
mongo_client = MongoClient(MONGO_URI)
mongo_db = mongo_client[MONGO_DB_NAME]
document_storage = GridFS(mongo_db)


@app.errorhandler(PyMongoError)
def mongo_storage_error(error):
    app.logger.error('MongoDB operation failed: %s', type(error).__name__)
    return jsonify({'error': 'MongoDB is unavailable; the operation could not be saved. Please retry.'}), 503

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

def employee_record_batches():
    """Read permanent records first, with compatibility for old queued uploads."""
    repair_softblocked_deployment_status(mongo_db)
    employees = list(mongo_db['employees'].find({}))
    yield {'records': employees}
    names = {employee['emp_name'] for employee in employees}
    for job in mongo_db['pending_neo4j_queue'].find({'type': {'$nin': ['job', 'job_delete']}}):
        records = [rec for rec in job.get('records', [])
                   if rec.get('emp_name') and rec['emp_name'] not in names]
        names.update(rec['emp_name'] for rec in records)
        yield {**job, 'records': records}


def get_pending_queue_data():
    """Aggregate current MongoDB employees and legacy queued imports."""
    result = {'skills': set(), 'clients': set(), 'locations': set(), 'domains': set(), 'levels': set(), 'deployment_statuses': set(), 'employees': []}
    try:
        for job in employee_record_batches():
            for rec in job.get('records', []):
                deployment_status = effective_deployment_status(rec)
                if deployment_status:
                    result['deployment_statuses'].add(deployment_status.upper())
                for sk in rec.get('skills', []) + rec.get('misc_skills', []):
                    if sk: result['skills'].add(sk)
                cn = normalize_client_name(rec.get('client_name'))
                if cn: result['clients'].add(cn)
                
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
    managed_names = [employee['emp_name'] for employee in mongo_db['employees'].find({}, {'emp_name': 1})]
    
    options = {
        'clients': [], 'locations': [], 'domains': [], 'skills': [], 'levels': [], 'deploymentStatuses': [],
        'benchMin': 0, 'benchMax': 0
    }
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                res = session.run("MATCH (s:Skill) RETURN DISTINCT s.name as name")
                options['skills'] = sorted([r['name'] for r in res if r['name']])
                res = session.run("MATCH (c:Client) RETURN DISTINCT c.name as name")
                options['clients'] = sorted([
                    r['name'] for r in res
                    if r['name'] and normalize_optional_text(r['name'])
                ])
                res = session.run("""
                    MATCH (e:Employee)
                    WHERE NOT e.name IN $managed_names
                    RETURN DISTINCT CASE WHEN toUpper(e.status) = 'SOFTBLOCKED'
                        THEN 'SOFTBLOCKED' ELSE coalesce(
                        e.deployment_status,
                        e.status
                    ) END as status
                """, managed_names=managed_names)
                options['deploymentStatuses'] = sorted([
                    status.upper() for r in res
                    if (status := normalize_optional_text(r['status']))
                ])
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
    options['deploymentStatuses'] = sorted(
        set(options['deploymentStatuses']) | pending['deployment_statuses']
    )
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
    
    if client == '__NO_CLIENT__':
        where_clauses.append(
            "coalesce(toLower(trim(toString(e.client_name))), '') IN ['', 'na', 'n/a', 'none', 'null', 'nan'] "
            "AND NOT EXISTS { MATCH (e)-[:WORKED_FOR]->(c:Client) "
            "WHERE toLower(trim(c.name)) NOT IN ['', 'na', 'n/a', 'none', 'null', 'nan'] }"
        )
    elif client:
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
        normalized_status = status.strip().upper()
        where_clauses.append("""
            toUpper(trim(CASE WHEN toUpper(e.status) = 'SOFTBLOCKED'
                THEN 'SOFTBLOCKED' ELSE coalesce(e.deployment_status, e.status)
            END)) = $status
        """)
        params['status'] = normalized_status
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
    repair_softblocked_deployment_status(mongo_db)
    canonical_names = {emp['emp_name'].lower() for emp in mongo_db['employees'].find({}, {'emp_name': 1})}
    seen_names = set()
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                result = session.run(query, **params)
                today = datetime.now(timezone.utc)
                for record in result:
                    node = record['e']
                    emp = dict(node)
                    if emp.get('name', '').lower() in canonical_names:
                        continue
                    
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
                        'deployment_status': 'SOFTBLOCKED' if emp.get('status') == 'SOFTBLOCKED' else emp.get('deployment_status'),
                        'client_name': emp.get('client_name'),
                        'current_project': emp.get('current_project'),
                        'performance': emp.get('performance'),
                        'available_since': emp.get('available_since'),
                        'bench_aging': bench_days,
                        'location': emp.get('location'),
                        'skills': emp.get('skills', []),
                        'softblock_job': emp.get('softblock_job'),
                        'softblock_company': emp.get('softblock_company'),
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

        for job in employee_record_batches():
            for rec in job.get('records', []):
                emp_name = rec.get('emp_name', '')
                if not emp_name or emp_name.lower() in seen_names:
                    continue

                all_skills = rec.get('skills', []) + rec.get('misc_skills', [])
                rec_client = normalize_client_name(rec.get('client_name'))
                if client == '__NO_CLIENT__' and rec_client: continue
                if client and client != '__NO_CLIENT__' and rec.get('client_name') != client: continue
                if location and location not in rec.get('location', []): continue
                if domain and domain not in rec.get('domain', []): continue
                if level and level not in rec.get('level', []): continue
                rec_status = effective_deployment_status(rec) or ''
                if status and status.strip().upper() != rec_status: continue
                if search and search.lower() not in emp_name.lower(): continue
                if skill_filter and not all(sk in all_skills for sk in skill_filter): continue

                avail_date_str = rec.get('available_since') or job.get('today', today_str)
                bench_days = 0
                try:
                    avail = datetime.strptime(avail_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                    bench_days = (today - avail).days
                except: pass

                if bench_min is not None and bench_days < bench_min: continue
                if bench_max is not None and bench_days > bench_max: continue

                seen_names.add(emp_name.lower())
                if rec.get('sync_version'):
                    employees.append(public_employee(rec))
                    continue
                employees.append({
                    'id': emp_name,
                    'name': emp_name,
                    'status': rec.get('status') or ('AVAILABLE' if not rec_client else None),
                    'deployment_status': rec_status or None,
                    'client_name': rec_client,
                    'current_project': rec.get('current_project'),
                    'performance': rec.get('performance'),
                    'available_since': avail_date_str,
                    'bench_aging': bench_days,
                    'location': rec.get('location', [None])[0] if rec.get('location') else None,
                    'skills': all_skills,
                    'softblock_job': rec.get('softblock_job'),
                    'softblock_company': rec.get('softblock_company'),
                    'softblock_manager': rec.get('softblock_manager'),
                    'softblock_start': rec.get('softblock_start'),
                    'softblock_expiry': rec.get('softblock_expiry'),
                    'interviews': [],
                    'neo4j_pending': True
                })
    except Exception as e:
        print(f"Error reading pending queue for employees: {e}")

    return jsonify(employees)

def load_editable_employee(emp_id, user):
    employee = find_employee(mongo_db, emp_id)
    if employee:
        return employee
    # Bring employees from an older upload into permanent storage on first edit.
    for batch in employee_record_batches():
        for rec in batch['records']:
            if emp_id in (rec.get('id'), rec.get('emp_name')):
                save_import(mongo_db, [rec], user.get('name'), None)
                return find_employee(mongo_db, rec['emp_name'])
    with get_neo4j_driver() as driver:
        with driver.session(database=NEO4J_DATABASE) as session:
            row = session.run('''
                MATCH (e:Employee) WHERE e.id = $id OR e.name = $id
                OPTIONAL MATCH (e)-[r]->(n)
                RETURN e, collect({relation: type(r), name: n.name}) AS related
            ''', id=emp_id).single()
            if not row:
                return None
            rec = dict(row['e'])
            rec['emp_name'] = rec['name']
            for key, relation in (('skills', 'HAS_SKILL'), ('misc_skills', 'HAS_MISC_SKILL'),
                                  ('domain', 'HAS_DOMAIN'), ('location', 'HAS_LOCATION'), ('level', 'HAS_LEVEL')):
                rec[key] = [item['name'] for item in row['related']
                            if item['relation'] == relation and item['name']]
            if not rec.get('client_name'):
                rec['client_name'] = next((item['name'] for item in row['related']
                                           if item['relation'] == 'WORKED_FOR'), None)
            save_import(mongo_db, [rec], user.get('name'), None)
            if rec.get('id'):
                mongo_db['employees'].update_one({'emp_name': rec['emp_name']}, {'$set': {'id': rec['id']}})
            return find_employee(mongo_db, rec['emp_name'])


def persist_employee_change(emp_id, user, changes):
    if not load_editable_employee(emp_id, user):
        return None
    employee = update_employee(mongo_db, emp_id, changes)
    if not employee:
        return None
    sync_employees(mongo_db, get_neo4j_driver, NEO4J_DATABASE, [employee])
    return find_employee(mongo_db, employee['id'])


@app.route('/employees/<path:emp_id>', methods=['PUT', 'OPTIONS'])
def edit_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({'error': 'Unauthorized'}), 401
    data = request.get_json(silent=True)
    allowed = {'deployment_status', 'client_name', 'current_project', 'performance',
               'available_since', *LIST_FIELDS}
    if not isinstance(data, dict) or not data or set(data) - allowed:
        return jsonify({'error': 'Provide supported employee fields only'}), 400
    changes = {}
    for field, value in data.items():
        if field in LIST_FIELDS:
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                return jsonify({'error': f'{field} must be a list of strings'}), 400
            changes[field] = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        else:
            if value is not None and not isinstance(value, str):
                return jsonify({'error': f'{field} must be text or null'}), 400
            changes[field] = normalize_optional_text(value)
    if 'deployment_status' in changes:
        changes['deployment_status'] = (changes['deployment_status'] or '').upper() or None
    if changes.get('available_since'):
        try:
            datetime.strptime(changes['available_since'], '%Y-%m-%d')
        except ValueError:
            return jsonify({'error': 'available_since must be YYYY-MM-DD'}), 400
    employee = persist_employee_change(emp_id, user, changes)
    if not employee: return jsonify({'error': 'Employee not found'}), 404
    return jsonify({'ok': True, 'employee': public_employee(employee),
                    'neo4j_pending': not employee['neo4j_synced']})


@app.route('/employees/<path:emp_id>/softblock', methods=['POST', 'OPTIONS'])
def softblock_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    data = request.json or {}
    
    job_label = (data.get('job_position') or data.get('job_label') or '').strip()
    company_name = (data.get('company_name') or '').strip()
    if not job_label or not company_name:
        return jsonify({"error": "Company name and job position are required"}), 400
    manager_name = data.get('manager_name') or user.get('name') or 'Admin'
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    expiry = (datetime.now(timezone.utc) + timedelta(days=SOFTBLOCK_DAYS)).strftime('%Y-%m-%d')
    
    employee = persist_employee_change(emp_id, user, {
        'status': 'SOFTBLOCKED', 'deployment_status': 'SOFTBLOCKED', 'softblock_job': job_label,
        'softblock_company': company_name,
        'softblock_manager': manager_name, 'softblock_start': today,
        'softblock_expiry': expiry,
    })
    if not employee: return jsonify({'error': 'Employee not found'}), 404
    emp_name = employee['emp_name']

    alert_doc = {
        'id': f"SB-{uuid.uuid4().hex[:8]}",
        'type': 'SOFTBLOCK',
        'employee': emp_name,
        'employee_id': emp_id,
        'job_description': job_label,
        'company_name': company_name,
        'softblocked_by': manager_name,
        'expiry_date': expiry,
        'sent_at': datetime.now(timezone.utc).isoformat(),
        'recipient': 'hr@company.com'
    }
    mongo_db['alerts'].insert_one(alert_doc)
    return jsonify({"ok": True, 'employee': public_employee(employee),
                    'neo4j_pending': not employee['neo4j_synced'],
                    "alert": {k: v for k, v in alert_doc.items() if k != '_id'}})

@app.route('/employees/<path:emp_id>/release', methods=['POST', 'OPTIONS'])
def release_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    previous = load_editable_employee(emp_id, user)
    if not previous: return jsonify({'error': 'Employee not found'}), 404
    released_from = previous.get('softblock_job') or 'Previous Opportunity'
    employee = persist_employee_change(emp_id, user, {
        'status': 'AVAILABLE', 'deployment_status': 'AVAILABLE', 'softblock_job': None, 'softblock_manager': None,
        'softblock_company': None, 'softblock_start': None, 'softblock_expiry': None,
    })
    emp_name = employee['emp_name']

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
    return jsonify({"ok": True, 'employee': public_employee(employee),
                    'neo4j_pending': not employee['neo4j_synced'],
                    "alert": {k: v for k, v in alert_doc.items() if k != '_id'}})

@app.route('/employees/<path:emp_id>/snooze', methods=['POST', 'OPTIONS'])
def snooze_employee(emp_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    expiry = (datetime.now(timezone.utc) + timedelta(days=SOFTBLOCK_DAYS)).strftime('%Y-%m-%d')
    previous = load_editable_employee(emp_id, user)
    if not previous or previous.get('status') != 'SOFTBLOCKED':
        return jsonify({'error': 'Soft-blocked employee was not found. No reminder was snoozed.'}), 404
    employee = persist_employee_change(emp_id, user, {'softblock_expiry': expiry})
    if not employee: return jsonify({'error': 'Employee not found'}), 404
    alert_doc = {
        'id': f"SNZ-{uuid.uuid4().hex[:8]}", 'type': 'SNOOZE',
        'employee': employee['emp_name'], 'employee_id': employee['id'],
        'expiry_date': expiry, 'sent_at': datetime.now(timezone.utc).isoformat(),
        'recipient': 'hr@company.com'
    }
    mongo_db['alerts'].insert_one(alert_doc)
    return jsonify({'ok': True, 'employee': public_employee(employee),
                    'neo4j_pending': not employee['neo4j_synced'],
                    'expiry_date': expiry,
                    'alert': {k: v for k, v in alert_doc.items() if k != '_id'}})

def public_job(job):
    return {key: value for key, value in job.items() if key not in ('_id', 'created_by')}


def sync_job_to_graph(job):
    with get_neo4j_driver() as driver:
        with driver.session(database=NEO4J_DATABASE) as session:
            session.run("""
                MERGE (j:Job {id: $job_id})
                SET j.role = $role, j.status = $status,
                    j.description = $description, j.name = $role
            """, job_id=job['id'], role=job['role'], status=job['status'],
                description=job['description']).consume()
            if job['client']:
                session.run("""
                    MATCH (j:Job {id: $job_id})
                    MERGE (c:Client {name: $client})
                    MERGE (j)-[:FOR_CLIENT]->(c)
                """, job_id=job['id'], client=job['client']).consume()
            if job['location']:
                session.run("""
                    MATCH (j:Job {id: $job_id})
                    MERGE (l:Location {name: $location})
                    MERGE (j)-[:IN_LOCATION]->(l)
                """, job_id=job['id'], location=job['location']).consume()


def delete_job_from_graph(job_id):
    with get_neo4j_driver() as driver:
        with driver.session(database=NEO4J_DATABASE) as session:
            session.run('MATCH (j:Job {id: $job_id}) DETACH DELETE j', job_id=job_id).consume()


@app.route('/jobs', methods=['GET', 'POST', 'OPTIONS'])
def add_job():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    if request.method == 'GET':
        jobs = [public_job(job) for job in mongo_db['jobs'].find({})]
        # Jobs created before MongoDB persistence was added can still be removed.
        for queued in mongo_db['pending_neo4j_queue'].find({'type': 'job'}):
            for index, record in enumerate(queued.get('records', [])):
                jobs.append({
                    'id': f"legacy-{queued['_id']}-{index}",
                    'role': record.get('job_role', ''),
                    'client': record.get('client_name', ''),
                    'location': record.get('location', ''),
                    'status': 'OPEN', 'description': '', 'required_skills': [],
                    'open_date': queued.get('today') or '', 'neo4j_synced': False,
                })
        return jsonify(sorted(jobs, key=lambda job: job.get('open_date', ''), reverse=True))

    data = request.get_json(silent=True) or {}
    role = str(data.get('role') or '').strip()
    if not role:
        return jsonify({'error': 'Role title is required.'}), 400
    skills = data.get('required_skills', [])
    if not isinstance(skills, list):
        return jsonify({'error': 'Required skills must be a list.'}), 400
    job = {
        'id': uuid.uuid4().hex,
        'role': role,
        'client': str(data.get('client') or '').strip(),
        'location': str(data.get('location') or '').strip(),
        'status': 'OPEN',
        'open_date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'description': str(data.get('description') or '').strip(),
        'required_skills': skills,
        'created_by': str(user['_id']),
        'neo4j_synced': False,
    }
    mongo_db['jobs'].insert_one(job)
    pending = True
    try:
        sync_job_to_graph(job)
        mongo_db['jobs'].update_one({'id': job['id']}, {'$set': {'neo4j_synced': True}})
        job['neo4j_synced'] = True
        pending = False
    except Exception as error:
        app.logger.warning('Job graph sync pending: %s', type(error).__name__)
    mongo_db['alerts'].insert_one({
        'id': f"JOB-{uuid.uuid4().hex[:8]}", 'type': 'JOB_CREATED',
        'employee': role, 'job_description': role,
        'company_name': job['client'], 'neo4j_pending': pending,
        'sent_at': datetime.now(timezone.utc).isoformat(),
        'recipient': 'hr@company.com'
    })
    return jsonify({'status': 'success', 'job': public_job(job), 'neo4j_pending': pending}), 201


@app.route('/jobs/<job_id>', methods=['DELETE', 'OPTIONS'])
def delete_job(job_id):
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({'error': 'Unauthorized'}), 401
    if job_id.startswith('legacy-'):
        from bson import ObjectId
        try:
            queue_id, index_text = job_id[7:].rsplit('-', 1)
            index = int(index_text)
            queued = mongo_db['pending_neo4j_queue'].find_one({'_id': ObjectId(queue_id), 'type': 'job'})
        except (ValueError, TypeError):
            queued = None
        if not queued or index < 0 or index >= len(queued.get('records', [])):
            return jsonify({'error': 'Job not found.'}), 404
        record = queued['records'].pop(index)
        if queued['records']:
            mongo_db['pending_neo4j_queue'].update_one({'_id': queued['_id']}, {'$set': {'records': queued['records']}})
        else:
            mongo_db['pending_neo4j_queue'].delete_one({'_id': queued['_id']})
        role, client = record.get('job_role', ''), record.get('client_name', '')
        pending = False
    else:
        job = mongo_db['jobs'].find_one({'id': job_id})
        if not job: return jsonify({'error': 'Job not found.'}), 404
        role, client = job['role'], job['client']
        # A tombstone prevents an offline graph node from returning after deletion.
        mongo_db['pending_neo4j_queue'].update_one(
            {'type': 'job_delete', 'job_id': job_id},
            {'$set': {'type': 'job_delete', 'job_id': job_id}}, upsert=True)
        mongo_db['jobs'].delete_one({'id': job_id})
        pending = True
        try:
            delete_job_from_graph(job_id)
            mongo_db['pending_neo4j_queue'].delete_many({'type': 'job_delete', 'job_id': job_id})
            pending = False
        except Exception as error:
            app.logger.warning('Job graph deletion pending: %s', type(error).__name__)
    mongo_db['alerts'].insert_one({
        'id': f"JOB-{uuid.uuid4().hex[:8]}", 'type': 'JOB_DELETED',
        'employee': role, 'job_description': role, 'company_name': client,
        'neo4j_pending': pending,
        'sent_at': datetime.now(timezone.utc).isoformat(),
        'recipient': 'hr@company.com'
    })
    return jsonify({'status': 'success', 'neo4j_pending': pending})

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
                res = session.run("MATCH (e:Employee) WHERE e.status = 'AVAILABLE' AND e.available_since IS NOT NULL RETURN e.id AS id, e.name AS name, e.available_since AS avail")
                for r in res:
                    try:
                        a_date = datetime.strptime(r['avail'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
                        days = (today - a_date).days
                        if days >= 45: alerts.append({'id': f"A45-{r['name']}", 'type': 'BENCH', 'threshold': 45, 'bench_age': days, 'employee': r['name'], 'employee_id': r['name'], 'sent_at': today_str, 'recipient': 'hr@company.com'})
                        elif days >= 30: alerts.append({'id': f"A30-{r['name']}", 'type': 'BENCH', 'threshold': 30, 'bench_age': days, 'employee': r['name'], 'employee_id': r['name'], 'sent_at': today_str, 'recipient': 'hr@company.com'})
                    except: pass

                # 2. All SOFTBLOCKED employees in graph
                res = session.run("MATCH (e:Employee) WHERE e.status = 'SOFTBLOCKED' RETURN e.id AS id, e.name AS name, e.softblock_expiry AS exp, e.softblock_job AS job, e.softblock_company AS company, e.softblock_manager AS manager, e.softblock_start AS start")
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
                                'company_name': r.get('company'),
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
                                'company_name': r.get('company'),
                                'softblocked_by': r.get('manager') or 'Manager',
                                'expiry_date': exp_str,
                                'sent_at': r.get('start') or today_str,
                                'recipient': 'hr@company.com'
                            })
                    except: pass
    except: pass

    # Include pending employees in automatic bench reminders and active soft-blocks.
    try:
        pending_seen = set()
        for job in employee_record_batches():
            for rec in job.get('records', []):
                emp_name = rec.get('emp_name')
                if not emp_name or emp_name.lower() in pending_seen:
                    continue
                pending_seen.add(emp_name.lower())
                if rec.get('status', 'AVAILABLE') == 'AVAILABLE':
                    try:
                        available_since = rec.get('available_since') or job.get('today')
                        bench_days = (today - datetime.strptime(available_since, '%Y-%m-%d').replace(tzinfo=timezone.utc)).days
                        threshold = 45 if bench_days >= 45 else 30 if bench_days >= 30 else None
                        if threshold and not any(a.get('type') == 'BENCH' and a.get('employee') == emp_name for a in alerts):
                            alerts.append({
                                'id': f"A{threshold}-{emp_name}", 'type': 'BENCH',
                                'threshold': threshold, 'bench_age': bench_days,
                                'employee': emp_name, 'employee_id': emp_name,
                                'sent_at': today_str, 'recipient': 'hr@company.com'
                            })
                    except (TypeError, ValueError):
                        pass
                if rec.get('status') == 'SOFTBLOCKED':
                    if emp_name and not any(a.get('employee') == emp_name and a.get('type') in ('SOFTBLOCK', 'SOFTBLOCK_EXPIRY') for a in alerts):
                        expiry_str = rec.get('softblock_expiry')
                        expired = bool(expiry_str and expiry_str <= today_str)
                        alerts.append({
                            'id': f"{'EXP' if expired else 'SB'}-{emp_name}",
                            'type': 'SOFTBLOCK_EXPIRY' if expired else 'SOFTBLOCK',
                            'employee': emp_name,
                            'employee_id': emp_name,
                            'job_description': rec.get('softblock_job') or 'Opportunity',
                            'company_name': rec.get('softblock_company'),
                            'softblocked_by': rec.get('softblock_manager') or 'Manager',
                            'expiry_date': expiry_str,
                            'sent_at': rec.get('softblock_start') or today_str,
                            'recipient': 'hr@company.com'
                        })
    except: pass

    # Persisted alerts from MongoDB
    mongo_alerts = list(mongo_db['alerts'].find({}, {'_id': 0}))

    # Keep every persisted change, including repeated soft-block/release cycles.
    # A current-state soft-block entry is redundant when the matching event exists.
    persisted_softblocks = {
        (a.get('employee'), a.get('job_description'), a.get('sent_at', '')[:10])
        for a in mongo_alerts if a.get('type') == 'SOFTBLOCK'
    }
    merged = []
    seen = set()
    for a in alerts:
        if a.get('type') == 'SOFTBLOCK' and (a.get('employee'), a.get('job_description'), a.get('sent_at', '')[:10]) in persisted_softblocks:
            continue
        key = a.get('id') or f"{a.get('type')}-{a.get('employee')}"
        if key not in seen:
            merged.append(a)
            seen.add(key)

    for ma in mongo_alerts:
        key = ma.get('id') or f"{ma.get('type')}-{ma.get('employee')}"
        if key not in seen:
            merged.append(ma)
            seen.add(key)

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
        for job in employee_record_batches():
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
    def graph_node(value):
        labels = list(value.labels)
        item = {'id': value.get('id', value.get('name')), 'label': value.get('name'), 'type': labels[0] if labels else 'Node'}
        if 'Employee' in labels:
            for field in ('status', 'available_since', 'softblock_job', 'softblock_company', 'softblock_manager', 'softblock_start', 'softblock_expiry'):
                item[field] = value.get(field)
        return item
    try:
        with get_neo4j_driver() as driver:
            with driver.session(database=NEO4J_DATABASE) as session:
                root_res = session.run("MATCH (n {name: $node}) RETURN n", node=node)
                root_rec = root_res.single()
                if root_rec:
                    nodes.append(graph_node(root_rec['n']))

                res = session.run("MATCH (n {name: $node})-[r]-(m) RETURN n, r, m", node=node)
                for rec in res:
                    n = rec['n']; m = rec['m']; r = rec['r']
                    n_id = n.get('id', n.get('name'))
                    m_id = m.get('id', m.get('name'))
                    if not any(d['id'] == n_id for d in nodes): nodes.append(graph_node(n))
                    if not any(d['id'] == m_id for d in nodes): nodes.append(graph_node(m))
                    links.append({'source': n_id if r.nodes[0] == n else m_id, 'target': m_id if r.nodes[0] == n else n_id, 'type': r.type})
    except Exception as e:
        print(f"Expand Neo4j error: {e}")

    # Overlay current MongoDB records, including changes awaiting graph sync.
    records = [rec for batch in employee_record_batches() for rec in batch['records']]
    canonical = {rec['emp_name']: rec for rec in records if rec.get('sync_version')}
    canonical_ids = {rec['id']: rec for rec in canonical.values()}
    legacy_ids = {rec.get('id') or rec['emp_name']: rec for rec in records
                  if not rec.get('sync_version') and rec.get('emp_name')}
    managed = set(canonical) | set(canonical_ids)
    imported_relations = {'WORKED_FOR', 'HAS_SKILL', 'HAS_MISC_SKILL',
                          'HAS_DOMAIN', 'HAS_LOCATION', 'HAS_LEVEL', 'WORKS_ON'}
    links = [link for link in links if not (
        link['source'] in managed and link['type'] in imported_relations)]
    node_map = {entry['id']: entry for entry in nodes}
    for rec in records:
        name = rec.get('emp_name')
        if not name:
            continue
        employee_id = rec.get('id', name)
        relations = [
            ('Client', 'WORKED_FOR', [rec['client_name']] if rec.get('client_name') else []),
            ('Project', 'WORKS_ON', [rec['current_project']] if rec.get('current_project') else []),
            ('Skill', 'HAS_SKILL', rec.get('skills', [])),
            ('Skill', 'HAS_MISC_SKILL', rec.get('misc_skills', [])),
            ('Domain', 'HAS_DOMAIN', rec.get('domain', [])),
            ('Location', 'HAS_LOCATION', rec.get('location', [])),
            ('Level', 'HAS_LEVEL', rec.get('level', [])),
        ]
        is_root = node in (name, employee_id)
        for label, relation, values in relations:
            for value in values:
                if value and (is_root or node == value):
                    node_map[employee_id] = {'id': employee_id, 'label': name, 'type': 'Employee'}
                    node_map[value] = {'id': value, 'label': value, 'type': label}
                    edge = {'source': employee_id, 'target': value, 'type': relation}
                    if edge not in links:
                        links.append(edge)
        if is_root:
            node_map[employee_id] = {'id': employee_id, 'label': name, 'type': 'Employee'}
    for entry in node_map.values():
        employee = canonical_ids.get(entry['id']) or canonical.get(entry.get('label'))
        if entry.get('type') == 'Employee' and employee:
            entry.update(public_employee(employee))
            entry.update(label=employee['emp_name'], type='Employee')
        elif entry.get('type') == 'Employee' and entry['id'] in legacy_ids:
            legacy = legacy_ids[entry['id']]
            entry.update(status=legacy.get('status') or 'AVAILABLE',
                         deployment_status=effective_deployment_status(legacy),
                         client_name=normalize_client_name(legacy.get('client_name')),
                         softblock_job=legacy.get('softblock_job'),
                         softblock_company=legacy.get('softblock_company'))
    connected = {node}
    for link in links:
        connected.update((link['source'], link['target']))
    nodes = [entry for entry in node_map.values()
             if entry['id'] in connected or entry.get('label') == node]
    return jsonify({'nodes': nodes, 'links': links})

def parse_skills(s):
    if isinstance(s, list):
        return list(dict.fromkeys(str(value).strip() for value in s if normalize_optional_text(value)))
    if not s or pd.isna(s): return []
    return [x.strip() for x in str(s).replace(';', ',').split(',') if x.strip()]

def normalize_optional_text(value):
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    if text.lower() in ('', 'na', 'n/a', 'none', 'null', 'nan'):
        return None
    return text

def normalize_client_name(value):
    name = normalize_optional_text(value)
    return None if name and name.lower() in ('no client', 'no clients') else name

def effective_deployment_status(record):
    if (str(record.get('status') or '').upper() == 'SOFTBLOCKED'
            and not record.get('sync_version')):
        return 'SOFTBLOCKED'
    explicit = normalize_optional_text(record.get('deployment_status'))
    if explicit:
        return explicit.upper()
    if str(record.get('status') or '').upper() == 'SOFTBLOCKED':
        return 'SOFTBLOCKED'
    if not normalize_client_name(record.get('client_name')):
        return 'AVAILABLE'
    status = normalize_optional_text(record.get('status'))
    return status.upper() if status else None

def get_ingested_value(row, aliases):
    columns = {re.sub(r'[^a-z0-9]', '', str(column).lower()): column for column in row.index}
    for alias in aliases:
        column = columns.get(re.sub(r'[^a-z0-9]', '', alias.lower()))
        if column is not None:
            return row.get(column)
    return None

@app.route('/ingestion/upload', methods=['POST', 'OPTIONS'])
def upload_file():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    if 'file' not in request.files: return jsonify({"error": "No file uploaded"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No file selected"}), 400
    original_document = file.read()
    file_stream = BytesIO(original_document)
    try:
        if file.filename.endswith('.csv'): df = pd.read_csv(file_stream)
        elif file.filename.endswith(('.xls', '.xlsx')): df = pd.read_excel(file_stream)
        elif file.filename.endswith('.json'):
            import json; data = json.loads(original_document)
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
        
        client_name = normalize_client_name(get_ingested_value(row, ['Client_Name']))
        deployment_status = normalize_optional_text(get_ingested_value(row, ['Deployment_Status']))
        rec = {
            'emp_name': ename,
            'client_name': client_name,
            'deployment_status': deployment_status.upper() if deployment_status else ('AVAILABLE' if client_name is None else None),
            'current_project': normalize_optional_text(get_ingested_value(row, ['Current_Project', 'Current_Projects', 'Project', 'Projects'])),
            'performance': normalize_optional_text(get_ingested_value(row, ['Performance'])),
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

    upload_id = uuid.uuid4().hex
    document_id = document_storage.put(
        original_document, filename=file.filename, content_type=file.mimetype,
        metadata={'upload_id': upload_id, 'user_id': str(user['_id'])},
    )
    save_import(mongo_db, records, owner, upload_id)
    mongo_db['upload_history'].insert_one({
        'id': upload_id, 'document_id': str(document_id),
        'columns': list(df.columns), 'schema_version': 1,
        'employee_names': list(dict.fromkeys(rec['emp_name'] for rec in records)),
        'user_id': str(user['_id']), 'user_name': user.get('name'), 'filename': file.filename,
        'timestamp': datetime.now(timezone.utc).isoformat(), 'rows_processed': len(records),
        'neo4j_synced': False
    })
    employees = list(mongo_db['employees'].find({'source_upload_id': upload_id}))
    neo4j_synced = sync_employees(mongo_db, get_neo4j_driver, NEO4J_DATABASE, employees)
    mongo_db['upload_history'].update_one({'id': upload_id}, {'$set': {'neo4j_synced': neo4j_synced}})
    mongo_db['alerts'].insert_one({
        'id': f"ING-{uuid.uuid4().hex[:8]}", 'type': 'INGESTION',
        'employee': f"{len(records)} employees", 'filename': file.filename,
        'rows_processed': len(records), 'neo4j_pending': not neo4j_synced,
        'sent_at': datetime.now(timezone.utc).isoformat(),
        'recipient': 'hr@company.com'
    })

    if neo4j_synced:
        return jsonify({"status": "success", 'upload_id': upload_id, 'mongo_saved': True,
                        "message": f"File stored in MongoDB. {len(records)} employees saved and synced to the knowledge graph."})
    else:
        return jsonify({"status": "success", 'upload_id': upload_id, 'mongo_saved': True,
                        "message": f"File and {len(records)} employees stored in MongoDB. Knowledge graph sync pending — Neo4j temporarily unavailable.", "neo4j_pending": True})

@app.route('/ingestion/uploads', methods=['GET', 'OPTIONS'])
def get_uploads():
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({"error": "Unauthorized"}), 401
    hist = list(mongo_db['upload_history'].find({'user_id': str(user['_id'])}, {'_id': 0}).sort('timestamp', -1))
    
    mapped_hist = []
    import uuid
    for h in hist:
        synced = h.get('neo4j_synced', True)
        if h.get('employee_names'):
            synced = not mongo_db['employees'].count_documents({
                'emp_name': {'$in': h['employee_names']}, 'neo4j_synced': False,
            })
        mapped_hist.append({
            'id': h.get('id', uuid.uuid4().hex),
            'filename': h.get('filename', 'Unknown'),
            'uploadedAt': h.get('timestamp', ''),
            'totalRows': h.get('rows_processed', 0),
            'totalNodes': h.get('rows_processed', 0) * 2,
            'totalRelationships': h.get('rows_processed', 0) * 3,
            'username': h.get('user_name', 'Unknown'),
            'mongo_saved': bool(h.get('document_id')),
            'neo4j_synced': synced
        })
    return jsonify(mapped_hist)

@app.route('/ingestion/sync-pending', methods=['POST', 'OPTIONS'])
def sync_pending_neo4j():
    """Sync current MongoDB state; never overwrite edits with upload snapshots."""
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({'error': 'Unauthorized'}), 401
    repair_softblocked_deployment_status(mongo_db)
    # Migrate old queued imports only when a permanent employee does not exist.
    for job in mongo_db['pending_neo4j_queue'].find({'type': {'$nin': ['job', 'job_delete']}}):
        for rec in job.get('records', []):
            if rec.get('emp_name') and not find_employee(mongo_db, rec['emp_name']):
                save_import(mongo_db, [rec], job.get('owner'), job.get('id'))
    pending = list(mongo_db['employees'].find({'neo4j_synced': False}))
    if not sync_employees(mongo_db, get_neo4j_driver, NEO4J_DATABASE, pending):
        return jsonify({'error': 'Knowledge graph unavailable; changes remain saved in MongoDB'}), 503
    jobs_synced = 0
    jobs_deleted = 0
    try:
        for deletion in mongo_db['pending_neo4j_queue'].find({'type': 'job_delete'}):
            delete_job_from_graph(deletion['job_id'])
            mongo_db['pending_neo4j_queue'].delete_one({'_id': deletion['_id']})
            jobs_deleted += 1
        for job in mongo_db['jobs'].find({'neo4j_synced': False}):
            sync_job_to_graph(job)
            mongo_db['jobs'].update_one({'id': job['id']}, {'$set': {'neo4j_synced': True}})
            jobs_synced += 1
    except Exception:
        return jsonify({'error': 'Job graph sync is pending; changes remain saved in MongoDB'}), 503
    # Mark each upload by its employees, including repeated filenames.
    for upload in mongo_db['upload_history'].find({}):
        names = upload.get('employee_names')
        if names:
            remaining = mongo_db['employees'].count_documents({
                'emp_name': {'$in': names}, 'neo4j_synced': False,
            })
            mongo_db['upload_history'].update_one({'_id': upload['_id']}, {'$set': {'neo4j_synced': remaining == 0}})
    for job in mongo_db['pending_neo4j_queue'].find({'type': {'$nin': ['job', 'job_delete']}}):
        names = [rec['emp_name'] for rec in job.get('records', []) if rec.get('emp_name')]
        if not mongo_db['employees'].count_documents({'emp_name': {'$in': names}, 'neo4j_synced': False}):
            mongo_db['pending_neo4j_queue'].delete_one({'_id': job['_id']})
            mongo_db['upload_history'].update_many(
                {'user_id': job.get('user_id'), 'filename': job.get('filename'), 'id': {'$exists': False}},
                {'$set': {'neo4j_synced': True}},
            )
    return jsonify({'synced': len(pending), 'jobs_synced': jobs_synced, 'jobs_deleted': jobs_deleted,
                    'message': f'Synced {len(pending)} employees and {jobs_synced} jobs to Neo4j'})

@app.route('/ingestion/clear', methods=['POST', 'OPTIONS'])
def clear_database():
    """Clear ingested documents, employees, upload history, and the graph."""
    if request.method == 'OPTIONS': return '', 204
    user = get_current_user()
    if not user: return jsonify({'error': 'Unauthorized'}), 401

    try:
        # Keep saved records if graph deletion fails, so stale graph data cannot
        # reappear after MongoDB has already been cleared.
        try:
            with get_neo4j_driver() as driver:
                with driver.session(database=NEO4J_DATABASE) as session:
                    def clear_graph(tx):
                        tx.run("MATCH (e:Employee) DETACH DELETE e").consume()
                        tx.run("MATCH (n) WHERE NOT (n)--() AND NOT n:Job DETACH DELETE n").consume()
                    session.execute_write(clear_graph)
        except Exception:
            return jsonify({'error': 'Neo4j is unavailable. Saved MongoDB records have been retained; retry clearing later.'}), 503
        for upload in mongo_db['upload_history'].find({}, {'document_id': 1}):
            if upload.get('document_id'):
                from bson import ObjectId
                document_storage.delete(ObjectId(upload['document_id']))
        mongo_db['employees'].delete_many({})
        mongo_db['upload_history'].delete_many({})
        mongo_db['pending_neo4j_queue'].delete_many({})

        return jsonify({"status": "success", "message": "Database cleared successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=8000)
