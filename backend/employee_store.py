"""MongoDB employee schema and the Neo4j employee projection.

MongoDB is authoritative. A pending flag is written with every change, before
attempting Neo4j, so retrying never needs to replay an outdated upload snapshot.
"""
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import CollectionInvalid


LIST_FIELDS = ('skills', 'misc_skills', 'domain', 'location', 'level')
TEXT_FIELDS = (
    'client_name', 'deployment_status', 'current_project', 'performance',
    'available_since', 'softblock_job', 'softblock_company', 'softblock_manager',
    'softblock_start', 'softblock_expiry',
)
EMPLOYEE_SCHEMA = {
    'bsonType': 'object',
    'required': ['id', 'emp_name', 'status', 'skills', 'misc_skills',
                 'domain', 'location', 'level', 'neo4j_synced', 'sync_version'],
    'properties': {
        'id': {'bsonType': 'string', 'minLength': 1},
        'emp_name': {'bsonType': 'string', 'minLength': 1},
        'status': {'enum': ['AVAILABLE', 'SOFTBLOCKED', 'MAPPED', 'DEPLOYED', 'TRAINING']},
        'deployment_status': {'bsonType': ['string', 'null']},
        **{field: {'bsonType': 'array', 'items': {'bsonType': 'string'}}
           for field in LIST_FIELDS},
        **{field: {'bsonType': ['string', 'null']}
           for field in TEXT_FIELDS if field != 'deployment_status'},
        'neo4j_synced': {'bsonType': 'bool'},
        'sync_version': {'bsonType': 'string'},
        'schema_version': {'bsonType': 'int'},
    },
}


def ensure_employee_schema(db):
    if 'employees' not in db.list_collection_names():
        try:
            db.create_collection('employees', validator={'$jsonSchema': EMPLOYEE_SCHEMA})
        except CollectionInvalid:
            pass  # Another request created the collection.
    # Upgrade collections created with the former Available/Deployed enum.
    validator = {'$jsonSchema': EMPLOYEE_SCHEMA}
    if db['employees'].options().get('validator') != validator:
        db.command({'collMod': 'employees', 'validator': validator})
    db['employees'].create_index('emp_name', unique=True)
    db['employees'].create_index('id', unique=True)
    db['employees'].create_index('neo4j_synced')


def save_import(db, records, owner, upload_id):
    ensure_employee_schema(db)
    now = datetime.now(timezone.utc).isoformat()
    for record in records:
        fields = {key: record.get(key) for key in TEXT_FIELDS
                  if not key.startswith('softblock_')}
        client_name = fields.get('client_name')
        if not client_name or str(client_name).strip().lower() in ('na', 'n/a', 'none', 'null', 'nan', 'no client', 'no clients'):
            fields['client_name'] = None
            if not fields.get('deployment_status'):
                fields['deployment_status'] = 'AVAILABLE'
        fields.update({key: record.get(key, []) for key in LIST_FIELDS})
        existing = db['employees'].find_one({'emp_name': record['emp_name']}, {'status': 1})
        if (existing or record).get('status') == 'SOFTBLOCKED':
            fields['deployment_status'] = 'SOFTBLOCKED'
        db['employees'].update_one(
            {'emp_name': record['emp_name']},
            {'$set': {
                **fields, 'owner': owner, 'source_upload_id': upload_id,
                'updated_at': now, 'neo4j_synced': False,
                'sync_version': uuid4().hex, 'schema_version': 2,
            }, '$setOnInsert': {
                'id': record['emp_name'], 'emp_name': record['emp_name'],
                'status': record.get('status') or 'AVAILABLE', 'created_at': now,
                **{key: record.get(key) for key in TEXT_FIELDS if key.startswith('softblock_')},
            }}, upsert=True,
        )


def find_employee(db, identifier):
    return db['employees'].find_one({'$or': [{'id': identifier}, {'emp_name': identifier}]})


def update_employee(db, identifier, changes):
    ensure_employee_schema(db)
    return db['employees'].find_one_and_update(
        {'$or': [{'id': identifier}, {'emp_name': identifier}]},
        {'$set': {**changes, 'updated_at': datetime.now(timezone.utc).isoformat(),
                  'neo4j_synced': False, 'sync_version': uuid4().hex, 'schema_version': 2}},
        return_document=ReturnDocument.AFTER,
    )


def repair_softblocked_deployment_status(db):
    """Repair the old status-only soft-blocks before exposing current records."""
    mismatch = {'status': 'SOFTBLOCKED', 'deployment_status': {'$ne': 'SOFTBLOCKED'},
                'schema_version': {'$ne': 2}}
    if db['employees'].find_one(mismatch, {'_id': 1}):
        ensure_employee_schema(db)
        db['employees'].update_many(mismatch, {'$set': {
            'deployment_status': 'SOFTBLOCKED', 'neo4j_synced': False,
            'sync_version': uuid4().hex, 'schema_version': 2,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }})


def project_employees(tx, records):
    tx.run('''
        UNWIND $records AS rec
        MERGE (e:Employee {name: rec.emp_name})
        SET e += rec.properties
    ''', records=records).consume()
    # Replace imported relationships, including ones removed by an edit/re-upload.
    tx.run('''
        UNWIND $records AS rec
        MATCH (e:Employee {name: rec.emp_name})
        OPTIONAL MATCH (e)-[r:WORKED_FOR|HAS_SKILL|HAS_MISC_SKILL|HAS_DOMAIN|HAS_LOCATION|HAS_LEVEL|WORKS_ON]->()
        DELETE r
    ''', records=records).consume()
    for field, label, relation in (
        ('clients', 'Client', 'WORKED_FOR'), ('skills', 'Skill', 'HAS_SKILL'),
        ('misc_skills', 'Skill', 'HAS_MISC_SKILL'), ('domain', 'Domain', 'HAS_DOMAIN'),
        ('location', 'Location', 'HAS_LOCATION'), ('level', 'Level', 'HAS_LEVEL'),
        ('projects', 'Project', 'WORKS_ON'),
    ):
        tx.run(f'''
            UNWIND $records AS rec
            MATCH (e:Employee {{name: rec.emp_name}})
            UNWIND rec.{field} AS value
            MERGE (n:{label} {{name: value}})
            MERGE (e)-[:{relation}]->(n)
        ''', records=records).consume()


def sync_employees(db, driver_factory, database, employees):
    if not employees:
        return True
    records = []
    for employee in employees:
        properties = {key: employee.get(key) for key in TEXT_FIELDS}
        properties.update({key: employee.get(key, []) for key in LIST_FIELDS})
        properties.update(id=employee['id'], name=employee['emp_name'],
                          status=employee['status'], owner=employee.get('owner'))
        records.append({
            'emp_name': employee['emp_name'], 'properties': properties,
            **{key: employee.get(key, []) for key in LIST_FIELDS},
            'clients': [employee['client_name']] if employee.get('client_name') else [],
            'projects': [employee['current_project']] if employee.get('current_project') else [],
        })
    try:
        with driver_factory() as driver:
            with driver.session(database=database) as session:
                session.execute_write(project_employees, records)
        for employee in employees:
            db['employees'].update_one(
                {'_id': employee['_id'], 'sync_version': employee['sync_version']},
                {'$set': {'neo4j_synced': True}},
            )
        return True
    except Exception:
        # MongoDB retains the current employee and pending flag for a later retry.
        return False


def public_employee(employee):
    result = {key: value for key, value in employee.items() if key != '_id'}
    if result.get('status') != 'SOFTBLOCKED' and not result.get('deployment_status') and not result.get('client_name'):
        result['deployment_status'] = 'AVAILABLE'
    result['name'] = employee['emp_name']
    result['neo4j_pending'] = not employee.get('neo4j_synced', False)
    result['location'] = ', '.join(employee.get('location', [])) or None
    result['skills'] = [{'name': name, 'proficiency': 3}
                        for name in dict.fromkeys(employee.get('skills', []) + employee.get('misc_skills', []))]
    result.setdefault('interviews', [])
    try:
        available = datetime.strptime(employee['available_since'], '%Y-%m-%d').replace(tzinfo=timezone.utc)
        result['bench_aging'] = (datetime.now(timezone.utc) - available).days
    except (KeyError, TypeError, ValueError):
        result['bench_aging'] = 0
    return result
