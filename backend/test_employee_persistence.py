"""Offline API regressions: use an in-memory MongoDB and a Neo4j test double.

Run: python -m unittest backend.test_employee_persistence -v
"""
import os
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

import mongomock
from mongomock.gridfs import enable_gridfs_integration
from gridfs import GridFS
from pymongo.errors import AutoReconnect

os.environ['MONGO_URI'] = 'mongodb://localhost:27017'
from backend import app as api
from backend.employee_store import EMPLOYEE_SCHEMA, find_employee, project_employees, update_employee


CSV = b'Emp_Name,Client_Name,Skills,misc skill,Deployment Status,Current Project,Performance,Location\nAlice,Acme,Python,SQL,DEPLOYED,Migration,Good,London\n'


class EmployeePersistenceTests(unittest.TestCase):
    def setUp(self):
        enable_gridfs_integration()
        self.db = mongomock.MongoClient().talentlens
        # mongomock cannot enforce validators; record the real validator argument.
        create_collection = self.db.create_collection
        self.schema_calls = []
        self.collection_validator = None

        def create_with_schema(name, **kwargs):
            self.schema_calls.append(kwargs.get('validator'))
            self.collection_validator = kwargs.get('validator')
            return create_collection(name)

        def command(arguments):
            self.assertEqual(arguments['collMod'], 'employees')
            self.collection_validator = arguments['validator']
            return {'ok': 1}

        for context in (
            patch.object(self.db.employees, 'options', create=True,
                         side_effect=lambda: {'validator': self.collection_validator}),
            patch.object(self.db, 'command', side_effect=command),
        ):
            context.start()
            self.addCleanup(context.stop)

        self.schema_patch = patch.object(self.db, 'create_collection', side_effect=create_with_schema)
        self.schema_patch.start()
        self.addCleanup(self.schema_patch.stop)
        self.user = {'_id': 'test-user', 'name': 'Tester', 'role': 'User'}
        self.session = MagicMock()
        empty_result = MagicMock()
        empty_result.single.return_value = None
        empty_result.__iter__.return_value = iter(())
        self.session.run.return_value = empty_result
        self.tx = MagicMock()
        self.projected = []

        def write(callback, *args):
            callback(self.tx, *args)
            if args:
                self.projected.extend(args[0])

        self.session.execute_write.side_effect = write
        self.driver = MagicMock()
        self.driver.__enter__.return_value = self.driver
        self.driver.session.return_value.__enter__.return_value = self.session
        self.driver_factory = MagicMock(return_value=self.driver)
        for target, value in (
            ('mongo_db', self.db), ('document_storage', GridFS(self.db)),
            ('get_current_user', lambda: self.user), ('get_neo4j_driver', self.driver_factory),
        ):
            context = patch.object(api, target, value)
            context.start()
            self.addCleanup(context.stop)
        api.app.config['TESTING'] = True
        self.client = api.app.test_client()

    def upload(self, content=CSV):
        return self.client.post('/ingestion/upload', data={'file': (BytesIO(content), 'staff.csv')})

    def offline(self):
        self.driver_factory.side_effect = RuntimeError('Neo4j offline')

    def online(self):
        self.driver_factory.side_effect = None

    def test_upload_persists_document_schema_and_graph(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['mongo_saved'])
        employee = find_employee(self.db, 'Alice')
        self.assertEqual(employee['deployment_status'], 'DEPLOYED')
        self.assertEqual(employee['skills'], ['Python'])
        self.assertTrue(employee['neo4j_synced'])
        self.assertEqual(self.schema_calls, [{'$jsonSchema': EMPLOYEE_SCHEMA}])
        self.assertEqual(GridFS(self.db).find_one({'filename': 'staff.csv'}).read(), CSV)
        self.assertEqual(self.projected[-1]['properties']['current_project'], 'Migration')
        self.assertEqual(self.projected[-1]['clients'], ['Acme'])
        self.assertEqual(self.db.alerts.find_one({'type': 'INGESTION'})['filename'], 'staff.csv')
        # All employee and relationship writes use the same Neo4j transaction.
        self.assertEqual(self.session.execute_write.call_count, 1)

    def test_upload_offline_stays_available_and_retry_syncs(self):
        self.offline()
        response = self.upload()
        self.assertTrue(response.json['neo4j_pending'])
        self.assertFalse(find_employee(self.db, 'Alice')['neo4j_synced'])
        self.assertEqual(self.client.get('/employees').json[0]['name'], 'Alice')
        self.assertEqual(self.client.get('/search?q=Alice').json[0]['id'], 'Alice')
        self.online()
        response = self.client.post('/ingestion/sync-pending')
        self.assertEqual(response.json['synced'], 1)
        self.assertTrue(find_employee(self.db, 'Alice')['neo4j_synced'])
        self.assertEqual(self.db.upload_history.find_one()['neo4j_synced'], True)

    def test_edit_then_retry_uses_latest_state_and_changes_relationships(self):
        self.upload()
        self.offline()
        response = self.client.put('/employees/Alice', json={
            'deployment_status': 'available', 'client_name': '',
            'current_project': None, 'performance': None, 'skills': ['Rust'],
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['neo4j_pending'])
        self.assertEqual(response.json['employee']['deployment_status'], 'AVAILABLE')
        employees = self.client.get('/employees?status=AVAILABLE&client=__NO_CLIENT__').json
        self.assertEqual([employee['name'] for employee in employees], ['Alice'])
        graph = self.client.get('/expand/Alice').json
        self.assertTrue(any(node['id'] == 'Rust' for node in graph['nodes']))
        self.assertFalse(any(node['id'] in ('Acme', 'Migration', 'Python') for node in graph['nodes']))
        self.online()
        self.client.post('/ingestion/sync-pending')
        self.assertEqual(self.projected[-1]['skills'], ['Rust'])
        self.assertEqual(self.projected[-1]['clients'], [])
        self.assertIsNone(self.projected[-1]['properties']['performance'])
        self.assertEqual(self.client.get('/employees').json[0]['deployment_status'], 'AVAILABLE')

    def test_softblock_snooze_release_persist_even_offline(self):
        self.upload()
        self.offline()
        response = self.client.post('/employees/Alice/softblock', json={'job_label': 'Job', 'company_name': 'Acme', 'manager_name': 'Manager'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(find_employee(self.db, 'Alice')['status'], 'SOFTBLOCKED')
        self.assertEqual(find_employee(self.db, 'Alice')['deployment_status'], 'SOFTBLOCKED')
        self.assertEqual(find_employee(self.db, 'Alice')['softblock_company'], 'Acme')
        snooze = self.client.post('/employees/Alice/snooze')
        self.assertEqual(snooze.status_code, 200)
        self.assertEqual(snooze.json['employee']['status'], 'SOFTBLOCKED')
        self.assertEqual(snooze.json['alert']['type'], 'SNOOZE')
        self.online()
        self.client.post('/ingestion/sync-pending')
        self.assertEqual(self.projected[-1]['properties']['softblock_job'], 'Job')
        self.assertEqual(self.projected[-1]['properties']['softblock_company'], 'Acme')
        self.assertEqual(self.projected[-1]['properties']['deployment_status'], 'SOFTBLOCKED')
        release = self.client.post('/employees/Alice/release')
        self.assertEqual(release.status_code, 200)
        employee = find_employee(self.db, 'Alice')
        self.assertEqual(employee['status'], 'AVAILABLE')
        self.assertEqual(employee['deployment_status'], 'AVAILABLE')
        self.assertIsNone(employee['softblock_job'])
        self.assertIsNone(employee['softblock_company'])
        self.assertTrue(employee['neo4j_synced'])
        self.assertEqual(self.client.post('/employees/Alice/snooze').status_code, 404)

    def test_reupload_upserts_without_duplicate_employees_or_resetting_softblock(self):
        self.upload()
        self.client.post('/employees/Alice/softblock', json={'job_label': 'Keep me', 'company_name': 'Acme'})
        self.upload(CSV.replace(b'Python', b'Rust'))
        self.assertEqual(self.db.employees.count_documents({}), 1)
        employee = find_employee(self.db, 'Alice')
        self.assertEqual(employee['skills'], ['Rust'])
        self.assertEqual(employee['status'], 'SOFTBLOCKED')
        self.assertEqual(employee['deployment_status'], 'SOFTBLOCKED')
        self.assertEqual(employee['softblock_job'], 'Keep me')
        self.assertEqual(self.projected[-1]['properties']['status'], 'SOFTBLOCKED')

    def test_legacy_queue_cannot_overwrite_newer_employee_edits(self):
        self.upload()
        self.db.pending_neo4j_queue.insert_one({
            'filename': 'staff.csv', 'owner': 'Tester', 'user_id': 'test-user',
            'records': [{'emp_name': 'Alice', 'skills': ['Old skill']}],
        })
        self.offline()
        self.client.put('/employees/Alice', json={'skills': ['New skill']})
        self.online()
        self.client.post('/ingestion/sync-pending')
        self.assertEqual(self.projected[-1]['skills'], ['New skill'])
        self.assertEqual(self.db.pending_neo4j_queue.count_documents({}), 0)

    def test_failed_projection_keeps_pending_and_old_sync_cannot_acknowledge_new_edit(self):
        self.upload()
        self.offline()
        self.client.put('/employees/Alice', json={'performance': 'First'})
        self.online()

        def concurrent_write(callback, records):
            callback(self.tx, records)
            update_employee(self.db, 'Alice', {'performance': 'Newer edit'})

        self.session.execute_write.side_effect = concurrent_write
        self.client.post('/ingestion/sync-pending')
        employee = find_employee(self.db, 'Alice')
        self.assertEqual(employee['performance'], 'Newer edit')
        self.assertFalse(employee['neo4j_synced'])

    def test_invalid_edits_and_missing_employee_do_not_report_success(self):
        self.upload()
        for payload in ({'deployment_status': 123}, {'skills': 'Python'},
                        {'owner': 'someone'}, {'available_since': 'bad-date'}, []):
            self.assertEqual(self.client.put('/employees/Alice', json=payload).status_code, 400)
        self.assertEqual(self.client.put('/employees/Missing', json={'performance': 'Good'}).status_code, 404)
        self.assertEqual(self.client.post('/employees/Missing/softblock', json={'job_label': 'Job', 'company_name': 'Acme'}).status_code, 404)

    def test_mongo_failure_does_not_write_neo4j_or_report_success(self):
        with patch.object(self.db, 'list_collection_names', side_effect=AutoReconnect('offline')):
            response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.session.execute_write.assert_not_called()

    def test_clear_and_sync_require_authentication(self):
        self.user = None
        for path in ('/ingestion/sync-pending', '/ingestion/clear'):
            self.assertEqual(self.client.post(path).status_code, 401)

    def test_clear_removes_employees_documents_and_history(self):
        self.upload()
        self.assertEqual(self.client.post('/ingestion/clear').status_code, 200)
        for name in ('employees', 'upload_history', 'fs.files', 'fs.chunks'):
            self.assertEqual(self.db[name].count_documents({}), 0)

    def test_clear_offline_keeps_saved_records(self):
        self.upload()
        self.offline()
        self.assertEqual(self.client.post('/ingestion/clear').status_code, 503)
        self.assertEqual(self.db.employees.count_documents({}), 1)
        self.assertEqual(self.db['fs.files'].count_documents({}), 1)

    def test_invalid_upload_does_not_store_document(self):
        response = self.upload(b'Wrong Column\nAlice\n')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.db.employees.count_documents({}), 0)
        self.assertEqual(self.db['fs.files'].count_documents({}), 0)

    def test_softblock_moves_available_employee_between_deployment_filters(self):
        self.upload(CSV.replace(b'DEPLOYED', b'AVAILABLE'))
        self.assertEqual([employee['name'] for employee in self.client.get('/employees?status=AVAILABLE').json], ['Alice'])
        self.client.post('/employees/Alice/softblock', json={'job_label': 'Job', 'company_name': 'Acme'})
        self.assertEqual(self.client.get('/employees?status=AVAILABLE').json, [])
        blocked = self.client.get('/employees?status=softblocked').json
        self.assertEqual([employee['name'] for employee in blocked], ['Alice'])
        self.assertEqual(blocked[0]['deployment_status'], 'SOFTBLOCKED')
        self.assertEqual(self.client.get('/filter-options').json['deploymentStatuses'], ['SOFTBLOCKED'])
        self.client.post('/employees/Alice/release')
        self.assertEqual(self.client.get('/employees?status=SOFTBLOCKED').json, [])
        self.assertEqual([employee['name'] for employee in self.client.get('/employees?status=AVAILABLE').json], ['Alice'])

    def test_excel_import_and_filters_accept_all_spreadsheet_statuses(self):
        rows = api.pd.read_csv(BytesIO(CSV))
        statuses = ['Available', 'Training', 'On Leave', 'Awaiting allocation', 'Softblocked']
        rows = api.pd.concat([rows] * len(statuses), ignore_index=True)
        rows['Emp_Name'] = [f'Employee {index}' for index in range(len(statuses))]
        rows['Deployment Status'] = statuses
        file = BytesIO()
        rows.to_excel(file, index=False, engine='openpyxl')
        file.seek(0)
        response = self.client.post('/ingestion/upload', data={'file': (file, 'staff.xlsx')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/filter-options').json['deploymentStatuses'], sorted(status.upper() for status in statuses))
        for index, status in enumerate(statuses):
            with self.subTest(status=status):
                response = self.client.get('/employees', query_string={'status': status})
                self.assertEqual([employee['name'] for employee in response.json], [f'Employee {index}'])
                self.assertEqual(find_employee(self.db, f'Employee {index}')['deployment_status'], status.upper())

    def test_excel_no_client_rows_map_to_available(self):
        rows = api.pd.DataFrame([
            {'Emp_Name': 'No Client Available', 'Client_Name': None, 'Skills': 'Python',
             'misc skill': 'SQL', 'Deployment Status': 'AVAILABLE'},
            {'Emp_Name': 'No Client Blank Status', 'Client_Name': 'No Clients', 'Skills': 'Java',
             'misc skill': 'AWS', 'Deployment Status': None},
        ])
        file = BytesIO()
        rows.to_excel(file, index=False, engine='openpyxl')
        file.seek(0)
        response = self.client.post('/ingestion/upload', data={'file': (file, 'no-clients.xlsx')})
        self.assertEqual(response.status_code, 200)
        for name in ('No Client Available', 'No Client Blank Status'):
            with self.subTest(name=name):
                employee = find_employee(self.db, name)
                self.assertIsNone(employee['client_name'])
                self.assertEqual(employee['deployment_status'], 'AVAILABLE')
                self.assertEqual(employee['status'], 'AVAILABLE')
        filtered = self.client.get('/employees?status=AVAILABLE&client=__NO_CLIENT__').json
        self.assertEqual({employee['name'] for employee in filtered},
                         {'No Client Available', 'No Client Blank Status'})

    def test_legacy_no_client_queue_maps_to_available_and_migrates(self):
        self.db.pending_neo4j_queue.insert_one({
            'owner': 'Tester', 'records': [{'emp_name': 'Legacy No Client',
                                          'client_name': None, 'skills': [],
                                          'misc_skills': [], 'domain': [],
                                          'location': [], 'level': []}],
        })
        filtered = self.client.get('/employees?status=AVAILABLE&client=__NO_CLIENT__').json
        self.assertEqual([employee['name'] for employee in filtered], ['Legacy No Client'])
        self.assertEqual(filtered[0]['deployment_status'], 'AVAILABLE')
        self.assertIn('AVAILABLE', self.client.get('/filter-options').json['deploymentStatuses'])
        expanded = self.client.get('/expand/Legacy No Client').json
        self.assertEqual(next(node for node in expanded['nodes'] if node['id'] == 'Legacy No Client')['deployment_status'], 'AVAILABLE')
        self.client.post('/ingestion/sync-pending')
        self.assertEqual(find_employee(self.db, 'Legacy No Client')['deployment_status'], 'AVAILABLE')

    def test_edit_accepts_custom_deployment_status(self):
        self.upload()
        response = self.client.put('/employees/Alice', json={'deployment_status': 'On Leave'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(find_employee(self.db, 'Alice')['deployment_status'], 'ON LEAVE')
        self.assertEqual(self.client.get('/employees?status=ON%20LEAVE').json[0]['name'], 'Alice')
        self.assertEqual(self.projected[-1]['properties']['deployment_status'], 'ON LEAVE')

    def test_legacy_softblock_is_repaired_and_schema_enum_is_upgraded(self):
        self.upload(CSV.replace(b'DEPLOYED', b'AVAILABLE'))
        self.db.employees.update_one({'emp_name': 'Alice'}, {'$set': {
            'status': 'SOFTBLOCKED', 'deployment_status': 'AVAILABLE',
            'schema_version': 1, 'neo4j_synced': True,
        }})
        self.collection_validator = {'$jsonSchema': {
            **EMPLOYEE_SCHEMA, 'properties': {
                **EMPLOYEE_SCHEMA['properties'],
                'deployment_status': {'enum': ['AVAILABLE', 'DEPLOYED', None]},
            },
        }}
        self.offline()
        self.assertEqual(self.client.get('/employees?status=AVAILABLE').json, [])
        self.assertEqual(find_employee(self.db, 'Alice')['deployment_status'], 'SOFTBLOCKED')
        self.assertFalse(find_employee(self.db, 'Alice')['neo4j_synced'])
        self.assertEqual(self.collection_validator, {'$jsonSchema': EMPLOYEE_SCHEMA})
        self.assertEqual(self.client.get('/filter-options').json['deploymentStatuses'], ['SOFTBLOCKED'])
        self.online()
        self.client.post('/ingestion/sync-pending')
        self.assertEqual(self.projected[-1]['properties']['deployment_status'], 'SOFTBLOCKED')

    def test_retry_repairs_legacy_softblock_without_a_prior_employee_read(self):
        self.upload()
        self.db.employees.update_one({'emp_name': 'Alice'}, {'$set': {
            'status': 'SOFTBLOCKED', 'deployment_status': 'AVAILABLE',
            'schema_version': 1, 'neo4j_synced': True,
        }})
        response = self.client.post('/ingestion/sync-pending')
        self.assertEqual(response.json['synced'], 1)
        self.assertEqual(find_employee(self.db, 'Alice')['deployment_status'], 'SOFTBLOCKED')
        self.assertEqual(self.projected[-1]['properties']['deployment_status'], 'SOFTBLOCKED')

    def test_explicit_deployment_edit_is_not_overwritten_by_legacy_repair(self):
        self.upload()
        self.client.post('/employees/Alice/softblock', json={'job_label': 'Job', 'company_name': 'Acme'})
        self.client.put('/employees/Alice', json={'deployment_status': 'Training'})
        self.assertEqual(self.client.get('/employees?status=TRAINING').json[0]['name'], 'Alice')
        self.assertEqual(self.client.get('/filter-options').json['deploymentStatuses'], ['TRAINING'])

    def test_job_can_be_created_loaded_and_deleted(self):
        created = self.client.post('/jobs', json={
            'role': 'Engineer', 'client': 'Acme', 'location': 'London',
            'required_skills': [{'name': 'Python', 'min_proficiency': 3}],
        })
        self.assertEqual(created.status_code, 201)
        job_id = created.json['job']['id']
        self.assertEqual([job['id'] for job in self.client.get('/jobs').json], [job_id])
        self.assertEqual(self.db.jobs.find_one({'id': job_id})['role'], 'Engineer')
        deleted = self.client.delete(f'/jobs/{job_id}')
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get('/jobs').json, [])
        self.assertIsNone(self.db.jobs.find_one({'id': job_id}))
        self.assertEqual(self.db.alerts.find_one({'type': 'JOB_DELETED'})['job_description'], 'Engineer')
        self.assertTrue(any('DETACH DELETE j' in call.args[0] for call in self.session.run.call_args_list))

    def test_offline_job_delete_stays_deleted_and_graph_retry_clears_tombstone(self):
        self.offline()
        created = self.client.post('/jobs', json={'role': 'Analyst', 'client': 'Acme'})
        job_id = created.json['job']['id']
        self.assertTrue(created.json['neo4j_pending'])
        self.assertEqual(self.db.jobs.find_one({'id': job_id})['neo4j_synced'], False)
        deleted = self.client.delete(f'/jobs/{job_id}')
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json['neo4j_pending'])
        self.assertEqual(self.client.get('/jobs').json, [])
        self.assertEqual(self.db.pending_neo4j_queue.count_documents({'type': 'job_delete'}), 1)
        self.online()
        self.assertEqual(self.client.post('/ingestion/sync-pending').status_code, 200)
        self.assertEqual(self.db.pending_neo4j_queue.count_documents({'type': 'job_delete'}), 0)
        self.assertEqual(self.client.get('/jobs').json, [])

    def test_legacy_queued_job_is_deletable(self):
        self.db.pending_neo4j_queue.insert_one({
            'type': 'job', 'records': [{'job_role': 'Designer', 'client_name': 'Acme', 'location': 'Pune'}]
        })
        job = self.client.get('/jobs').json[0]
        self.assertEqual(job['role'], 'Designer')
        self.assertEqual(self.client.delete(f"/jobs/{job['id']}").status_code, 200)
        self.assertEqual(self.db.pending_neo4j_queue.count_documents({'type': 'job'}), 0)


if __name__ == '__main__':
    unittest.main()
