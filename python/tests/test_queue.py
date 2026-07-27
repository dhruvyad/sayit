"""Mutual-exclusion tests for the playback queue.

Mirrors test/queue.test.js in the npm build. Both are silent: they exercise the
lock directly rather than going through playback.
"""

import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

LOCK_PATH = Path(tempfile.gettempdir()) / f"saynow-queue-test-{os.getpid()}.lock"
os.environ["SAYNOW_LOCK_PATH"] = str(LOCK_PATH)

from saynow.audio import queued  # noqa: E402  (must follow the env override)


class QueueTest(unittest.TestCase):
    def tearDown(self):
        LOCK_PATH.unlink(missing_ok=True)

    def test_lock_is_created_and_removed(self):
        with queued():
            self.assertTrue(LOCK_PATH.exists(), "lock should exist while held")
            holder = json.loads(LOCK_PATH.read_text())
            self.assertEqual(holder["pid"], os.getpid())
        self.assertFalse(LOCK_PATH.exists(), "lock should be gone after release")

    def test_disabled_queue_takes_no_lock(self):
        with queued(enabled=False):
            self.assertFalse(LOCK_PATH.exists(), "--no-queue must not take the lock")

    def test_lock_is_released_when_the_body_raises(self):
        with self.assertRaises(RuntimeError):
            with queued():
                raise RuntimeError("boom")
        self.assertFalse(LOCK_PATH.exists(), "lock must be released on exception")

    def test_concurrent_holders_never_overlap(self):
        holders, intervals, lock = 8, [], threading.Lock()

        def hold():
            with queued():
                enter = time.monotonic()
                time.sleep(0.025)
                exit_at = time.monotonic()
            with lock:
                intervals.append((enter, exit_at))

        threads = [threading.Thread(target=hold) for _ in range(holders)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        self.assertEqual(len(intervals), holders, "every holder should have run")

        intervals.sort()
        for i in range(1, len(intervals)):
            self.assertGreaterEqual(
                intervals[i][0],
                intervals[i - 1][1],
                f"holder {i} entered before holder {i - 1} exited",
            )

    def test_dead_holder_is_reclaimed(self):
        # pid 999999 is far above the default pid_max and is not running.
        LOCK_PATH.write_text(json.dumps({"pid": 999999, "at": time.time()}))
        with queued(timeout=5):
            holder = json.loads(LOCK_PATH.read_text())
            self.assertEqual(holder["pid"], os.getpid(), "lock should now be ours")

    def test_corrupt_lock_is_reclaimed(self):
        LOCK_PATH.write_text("this is not json")
        with queued(timeout=5):
            pass
        self.assertFalse(LOCK_PATH.exists())

    def test_lock_past_the_stale_window_is_reclaimed(self):
        # Our own pid is alive, so only the age check can release this one.
        LOCK_PATH.write_text(json.dumps({"pid": os.getpid(), "at": 0}))
        with queued(timeout=5):
            pass


if __name__ == "__main__":
    unittest.main()
