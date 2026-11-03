import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocationOptions, getEmployeeLocations } from './employeeLocations.js';

test('Bangalore spellings share one Bengaluru option and other cities remain', () => {
  const employees = [{ location: 'Bangalore' }, { locations: ['Bengaluru', 'Banglore'] }, { location: 'Chennai' }];
  assert.deepEqual(getLocationOptions(employees, ['Stale job city']), ['Bengaluru', 'Chennai']);
  assert.deepEqual(getEmployeeLocations(employees[1]), ['Bengaluru']);
  assert.deepEqual(getLocationOptions([], ['Bangalore', 'Bengaluru', 'Pune']), ['Bengaluru', 'Pune']);
});
