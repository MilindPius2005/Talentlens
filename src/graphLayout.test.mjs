import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout } from './graphLayout.js';

test('lays out cycles, disconnected nodes and object link endpoints without changing input', () => {
  const nodes = ['root', 'left', 'right', 'orphan'].map(id => ({ id }));
  const links = [
    { source: { id: 'root' }, target: 'left' },
    { source: 'root', target: 'right' },
    { source: 'left', target: 'right' },
    { source: 'missing', target: 'root' },
  ];
  const original = JSON.stringify({ nodes, links });
  const positions = buildLayout(nodes, links, 'root', 900, 650);
  assert.equal(positions.size, 4);
  assert.equal(positions.get('root').x, 450);
  assert.ok(positions.get('root').y < positions.get('left').y);
  assert.ok(positions.get('left').x < positions.get('right').x);
  assert.ok(positions.get('orphan').y > positions.get('left').y);
  assert.equal(JSON.stringify({ nodes, links }), original);
});

test('lays out a 20000-node chain without overflowing the stack', () => {
  const nodes = Array.from({ length: 20000 }, (_, id) => ({ id }));
  const links = nodes.slice(1).map(({ id }) => ({ source: id - 1, target: id }));
  const positions = buildLayout(nodes, links, 0, 900, 650);
  assert.equal(positions.size, nodes.length);
  assert.ok(Number.isFinite(positions.get(19999).y));
  assert.equal(positions.get(0).x, positions.get(19999).x);
});
