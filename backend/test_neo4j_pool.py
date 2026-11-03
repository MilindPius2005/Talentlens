import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.neo4j_pool import Neo4jPool


class Neo4jPoolTests(unittest.TestCase):
    @patch('backend.neo4j_pool.GraphDatabase.driver')
    def test_concurrent_requests_reuse_pool_and_request_exit_does_not_close_it(self, create_driver):
        pool = Neo4jPool()
        self.addCleanup(pool.close)

        def request(_):
            with pool.acquire('neo4j+s://example.invalid', 'user', 'test-password') as driver:
                return driver

        with ThreadPoolExecutor(max_workers=8) as executor:
            drivers = list(executor.map(request, range(20)))
        create_driver.assert_called_once()
        self.assertTrue(all(driver is create_driver.return_value for driver in drivers))
        create_driver.return_value.close.assert_not_called()
        with self.assertRaises(RuntimeError):
            with pool.acquire('neo4j+s://example.invalid', 'user', 'test-password'):
                raise RuntimeError('query failed')
        create_driver.return_value.close.assert_not_called()
        pool.close()
        pool.close()
        create_driver.return_value.close.assert_called_once()

    @patch('backend.neo4j_pool.GraphDatabase.driver')
    def test_worker_process_does_not_reuse_parent_connections(self, create_driver):
        pool = Neo4jPool()
        self.addCleanup(pool.close)
        with patch('backend.neo4j_pool.os.getpid', return_value=1):
            with pool.acquire('uri', 'user', 'test-password'):
                pass
        with patch('backend.neo4j_pool.os.getpid', return_value=2):
            with pool.acquire('uri', 'user', 'test-password'):
                pass
            pool.close()
        self.assertEqual(create_driver.call_count, 2)
