import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeploymentStatuses, reconcileEmployeeGraph } from './deploymentStatuses.js';

test('deployment choices include all imported values and current soft-blocks', () => {
  assert.deepEqual(getDeploymentStatuses([
    { deployment_status: ' Training ', status: 'AVAILABLE' },
    { deployment_status: 'On Leave' },
    { deployment_status: 'SOFTBLOCKED', status: 'SOFTBLOCKED' },
    { deployment_status: 'training' },
  ]), ['ON LEAVE', 'SOFTBLOCKED', 'TRAINING']);
});

test('a saved soft-block replaces available without adding fixed statuses', () => {
  assert.deepEqual(getDeploymentStatuses([
    { deployment_status: 'SOFTBLOCKED', status: 'SOFTBLOCKED' },
  ]), ['SOFTBLOCKED']);
});

test('server options and legacy employee values are normalized and deduplicated', () => {
  assert.deepEqual(getDeploymentStatuses([
    { status: 'MAPPED' }, { deployment_status: null },
  ], [' awaiting allocation ', 'MAPPED', '', null]), ['AWAITING ALLOCATION', 'MAPPED']);
});

test('a deployment change from polling removes employees and links from an Available graph', () => {
  const graph = {
    nodes: [
      { id: 'Python', type: 'Skill' },
      { id: 'Alice', type: 'Employee', deployment_status: 'AVAILABLE' },
      { id: 'Bob', type: 'Employee', deployment_status: 'AVAILABLE' },
    ],
    links: [
      { source: { id: 'Alice' }, target: 'Python' },
      { source: 'Bob', target: 'Python' },
    ],
  };
  const saved = [{ id: 'Alice', status: 'DEPLOYED', deployment_status: 'DEPLOYED', client_name: 'Acme' }];
  const filtered = reconcileEmployeeGraph(graph, saved, 'AVAILABLE', 'Python');
  assert.deepEqual(filtered.nodes.map(node => node.id), ['Python', 'Bob']);
  assert.deepEqual(filtered.links, [graph.links[1]]);
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(reconcileEmployeeGraph(graph, saved, 'AVAILABLE', 'Alice'), { nodes: [], links: [] });
});

test('polling preserves newer graph data and keeps unchanged graph identity', () => {
  const node = {
    id: 'Alice', type: 'Employee', deployment_status: 'DEPLOYED', updated_at: '2026-11-04T12:00:00Z',
  };
  const graph = { nodes: [node], links: [] };
  assert.equal(reconcileEmployeeGraph(graph, [], 'DEPLOYED'), graph);
  assert.equal(reconcileEmployeeGraph(graph, [{
    id: 'Alice', deployment_status: 'AVAILABLE', updated_at: '2026-11-04T11:59:00Z',
  }], 'DEPLOYED'), graph);
  const latest = { id: 'Alice', deployment_status: 'ON LEAVE', updated_at: '2026-11-04T12:01:00Z' };
  const updated = reconcileEmployeeGraph(graph, [latest]);
  assert.equal(updated.nodes[0].deployment_status, 'ON LEAVE');
  assert.equal(reconcileEmployeeGraph(updated, [latest]), updated);
});
