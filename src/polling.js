// Poll only the visible app, with at most one refresh in flight.
export function startPolling(refresh, { interval = 8000, page = document, timers = globalThis } = {}) {
  const controller = new AbortController();
  let timer, running = false, stopped = false;
  async function poll() {
    if (stopped || running || page.hidden) return;
    running = true;
    try {
      await refresh(controller.signal);
    } finally {
      running = false;
      if (!stopped && !page.hidden) timer = timers.setTimeout(poll, interval);
    }
  }
  function visibilityChanged() {
    timers.clearTimeout(timer);
    if (!page.hidden) void poll();
  }
  page.addEventListener('visibilitychange', visibilityChanged);
  void poll();
  return () => {
    stopped = true;
    timers.clearTimeout(timer);
    controller.abort();
    page.removeEventListener('visibilitychange', visibilityChanged);
  };
}

export function reuseUnchangedRows(previous, incoming) {
  if (previous.length === incoming.length && JSON.stringify(previous) === JSON.stringify(incoming)) return previous;
  return incoming;
}
