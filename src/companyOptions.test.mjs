import test from 'node:test';
import assert from 'node:assert/strict';
import { getCurrentCompanies, pruneDeletedJobNodes } from './companyOptions.js';

test('deleted jobs stop contributing companies while employee and remaining-job references survive', () => {
  const employees = [{ client_name: 'Acme' }, { client_name: null, client_names: ['Legacy Client'] }];
  const jobs = [{ id: '1', client: 'PlaySimple' }, { id: '2', client: 'Tower Research' }];
  assert.deepEqual(getCurrentCompanies(employees, jobs), ['Acme', 'Legacy Client', 'PlaySimple', 'Tower Research']);
  assert.deepEqual(getCurrentCompanies(employees, jobs.slice(1)), ['Acme', 'Legacy Client', 'Tower Research']);
  assert.deepEqual(getCurrentCompanies(employees, []), ['Acme', 'Legacy Client']);
});

test('stale company and job nodes disappear without removing employee data', () => {
  const graph = { nodes: [
    { id: 'Alice', type: 'Employee' }, { id: 'Acme', type: 'Client' },
    { id: 'PlaySimple', type: 'Client' }, { id: 'deleted-job', type: 'Job' },
    { id: 'Job-only city', type: 'Location' }, { id: 'Chennai', type: 'Location' },
  ], links: [
    { source: 'Alice', target: 'Acme' }, { source: 'deleted-job', target: 'PlaySimple' },
  ] };
  const employees = [{ id: 'Alice', location: 'Chennai' }];
  const pruned = pruneDeletedJobNodes(graph, ['Acme'], [], employees);
  assert.deepEqual(pruned.nodes.map(node => node.id), ['Alice', 'Acme', 'Chennai']);
  assert.deepEqual(pruned.links, [{ source: 'Alice', target: 'Acme' }]);
  assert.equal(pruneDeletedJobNodes(pruned, ['Acme'], [], employees), pruned);
});
