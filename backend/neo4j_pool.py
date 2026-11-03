"""Keep one thread-safe Neo4j connection pool per server worker."""
import atexit
import os
from contextlib import contextmanager
from threading import Lock

from neo4j import GraphDatabase


class Neo4jPool:
    def __init__(self):
        self._driver = None
        self._pid = None
        self._lock = Lock()
        atexit.register(self.close)

    @contextmanager
    def acquire(self, uri, user, password):
        # A Driver owns a connection pool and is safe to share across threads.
        # Sessions remain short-lived; exiting a request must not close the pool.
        with self._lock:
            if self._driver is None or self._pid != os.getpid():
                self._driver = GraphDatabase.driver(
                    uri, auth=(user, password), connection_timeout=5,
                    max_transaction_retry_time=5,
                )
                self._pid = os.getpid()
            driver = self._driver
        yield driver

    def close(self):
        with self._lock:
            if self._driver is not None and self._pid == os.getpid():
                self._driver.close()
            self._driver = None
            self._pid = None
