"""One availability rule for imports, edits, graph records and employee filters."""

EMPTY_VALUES = {'', 'na', 'n/a', 'none', 'null', 'nan'}


def optional_text(value, empty_values=EMPTY_VALUES):
    if value is None:
        return None
    text = str(value).strip()
    return None if text.lower() in empty_values else text


def client_name(value):
    return optional_text(value, EMPTY_VALUES | {'no client', 'no clients'})


def project_name(value):
    return optional_text(value, EMPTY_VALUES | {'no project', 'no projects'})


def has_assignment(record):
    # Legacy Neo4j employees can have relationships without matching properties.
    for field, normalize in (('client_name', client_name), ('client_names', client_name),
                             ('current_project', project_name), ('projects', project_name)):
        value = record.get(field)
        values = value if isinstance(value, (list, tuple)) else [value]
        if any(normalize(item) for item in values):
            return True
    return False


def effective_deployment_status(record):
    workflow = (optional_text(record.get('status')) or '').upper()
    if workflow == 'SOFTBLOCKED' and not record.get('sync_version'):
        return workflow
    explicit = optional_text(record.get('deployment_status'))
    status = explicit.upper() if explicit else workflow
    # Preserve explicit non-available statuses, including custom spreadsheet values.
    if status and status != 'AVAILABLE':
        return status
    # An assignment disqualifies Available even when an old/default flag says it.
    return 'DEPLOYED' if has_assignment(record) else 'AVAILABLE'


def employee_status_fields(record):
    deployment = effective_deployment_status(record)
    # The workflow field has a fixed schema; deployment_status retains custom values.
    workflow = deployment if deployment in {'AVAILABLE', 'SOFTBLOCKED', 'DEPLOYED', 'TRAINING', 'MAPPED'} else 'MAPPED'
    return {'status': workflow, 'deployment_status': deployment}
