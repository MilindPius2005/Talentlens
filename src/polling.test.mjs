import test from 'node:test';
import assert from 'node:assert/strict';
import { startPolling, reuseUnchangedRows } from './polling.js';

function environment() {
  const listeners = new Set(), pending = new Map();
  let nextId = 0;
  const page = {
    hidden: false,
    addEventListener: (_, callback) => listeners.add(callback),
    removeEventListener: (_, callback) => listeners.delete(callback),
    changeVisibility(hidden) { this.hidden = hidden; listeners.forEach(callback => callback()); },
  };
  const timers = {
    setTimeout(callback) { const id = ++nextId; pending.set(id, callback); return id; },
    clearTimeout(id) { pending.delete(id); },
    fire() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); },
  };
  return { page, timers, pending };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('slow refreshes never overlap, pause when hidden, resume and abort on cleanup', async () => {
  const env = environment();
  let calls = 0, release, signal;
  const stop = startPolling(nextSignal => {
    calls++;
    signal = nextSignal;
    return new Promise(resolve => { release = resolve; });
  }, env);
  assert.equal(calls, 1);
  assert.equal(env.pending.size, 0);
  env.page.changeVisibility(true);
  env.page.changeVisibility(false);
  assert.equal(calls, 1);
  release();
  await flush();
  assert.equal(env.pending.size, 1);
  env.page.changeVisibility(true);
  env.timers.fire();
  assert.equal(calls, 1);
  env.page.changeVisibility(false);
  assert.equal(calls, 2);
  stop();
  assert.equal(signal.aborted, true);
  release();
  await flush();
  assert.equal(env.pending.size, 0);
});

test('unchanged responses keep state identity, but status changes are delivered', () => {
  const previous = [{ id: 'Alice', status: 'AVAILABLE' }];
  assert.equal(reuseUnchangedRows(previous, [{ ...previous[0] }]), previous);
  const changed = [{ id: 'Alice', status: 'SOFTBLOCKED' }];
  assert.equal(reuseUnchangedRows(previous, changed), changed);
});
