import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeploymentStatuses } from './deploymentStatuses.js';

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
