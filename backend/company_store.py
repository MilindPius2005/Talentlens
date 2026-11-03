"""Current company references and safe cleanup of unused graph clients."""


def normalize_company_name(value):
    if value is None:
        return None
    name = str(value).strip()
    return None if name.lower() in ('', 'na', 'n/a', 'none', 'null', 'nan', 'no client', 'no clients') else name


def company_context(db, employee_records):
    clients, protected, protected_locations = set(), set(), set()
    for employee in employee_records:
        name = normalize_company_name(employee.get('client_name'))
        if name:
            clients.add(name)
        locations = employee.get('location') or []
        protected_locations.update([locations] if isinstance(locations, str) else locations)
        if employee.get('status') == 'SOFTBLOCKED':
            reserved = normalize_company_name(employee.get('softblock_company'))
            if reserved:
                protected.add(reserved)
    jobs = list(db['jobs'].find({}, {'id': 1, 'client': 1, 'location': 1}))
    job_companies, job_locations = set(), set()
    for job in jobs:
        name = normalize_company_name(job.get('client'))
        if name:
            clients.add(name)
            job_companies.add(name)
        if job.get('location'):
            protected_locations.add(job['location'])
            job_locations.add(job['location'])
    for batch in db['pending_neo4j_queue'].find({'type': 'job'}):
        for job in batch.get('records', []):
            name = normalize_company_name(job.get('client_name'))
            if name:
                clients.add(name)
                job_companies.add(name)
            if job.get('location'):
                protected_locations.add(job['location'])
                job_locations.add(job['location'])
    for deletion in db['pending_neo4j_queue'].find({'type': 'job_delete'}):
        if deletion.get('client'):
            job_companies.add(deletion['client'])
        if deletion.get('location'):
            job_locations.add(deletion['location'])
    for alert in db['alerts'].find({'type': {'$in': ['JOB_CREATED', 'JOB_DELETED']}}, {'company_name': 1, 'location': 1}):
        if alert.get('company_name'):
            job_companies.add(alert['company_name'])
        if alert.get('location'):
            job_locations.add(alert['location'])
    return {
        'clients': sorted(clients),
        'protected_clients': sorted(clients | protected),
        'job_ids': [job['id'] for job in jobs if job.get('id')],
        'managed_names': list({record['emp_name'] for record in employee_records if record.get('emp_name')}),
        'job_companies': sorted(job_companies),
        'job_locations': sorted(job_locations),
        'protected_locations': sorted(protected_locations),
    }


def prune_orphan_clients(tx, protected_clients, job_companies):
    # DELETE (not DETACH DELETE) also protects against accidentally removing
    # an employee/job relationship if another writer connects this client.
    record = tx.run('''
        MATCH (c:Client)
        WHERE NOT (c)--() AND NOT c.name IN $protected_clients
          AND (c.created_by_jobs = true OR c.name IN $job_companies)
        WITH collect(c) AS clients, collect(c.name) AS removed_clients
        FOREACH (client IN clients | DELETE client)
        RETURN removed_clients
    ''', protected_clients=protected_clients, job_companies=job_companies).single()
    return record['removed_clients'] if record else []


def prune_orphan_job_locations(tx, context):
    tx.run('''
        MATCH (l:Location)
        WHERE NOT (l)--() AND NOT l.name IN $protected_locations
          AND (l.created_by_jobs = true OR l.name IN $job_locations)
        DELETE l
    ''', protected_locations=context['protected_locations'], job_locations=context['job_locations']).consume()


def graph_node_is_current(node, context, has_employee_reference=False):
    if node is None:
        return False
    if 'Client' in node.labels and node.get('name') not in context['clients'] and not has_employee_reference:
        return False
    if 'Job' in node.labels and node.get('id') not in context['job_ids']:
        return False
    if 'Location' in node.labels and node.get('name') not in context['protected_locations'] and not has_employee_reference:
        return False
    return True
