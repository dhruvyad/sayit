import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

const LOCK_PATH = path.join(os.tmpdir(), `saynow-queue-test-${process.pid}.lock`);
process.env.SAYNOW_LOCK_PATH = LOCK_PATH;

const { acquire } = await import('../src/queue.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

afterEach(() => fs.rmSync(LOCK_PATH, { force: true }));

test('acquire creates the lock and release removes it', async () => {
  const release = await acquire();
  assert.ok(fs.existsSync(LOCK_PATH), 'lock file should exist while held');

  const holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  assert.equal(holder.pid, process.pid, 'lock should record the holding pid');

  release();
  assert.ok(!fs.existsSync(LOCK_PATH), 'lock file should be gone after release');
});

test('release is idempotent', async () => {
  const release = await acquire();
  release();
  release(); // must not throw, and must not delete a lock it no longer owns
  assert.ok(!fs.existsSync(LOCK_PATH));
});

test('a second acquire waits until the first releases', async () => {
  const first = await acquire();

  let secondAcquiredAt = null;
  const pending = acquire().then((release) => {
    secondAcquiredAt = Date.now();
    return release;
  });

  await sleep(150);
  assert.equal(secondAcquiredAt, null, 'second acquire must not succeed while held');

  const releasedAt = Date.now();
  first();

  const release = await pending;
  assert.ok(
    secondAcquiredAt >= releasedAt,
    'second acquire should only succeed after the first released',
  );
  release();
});

test('concurrent holders never overlap', async () => {
  const HOLDERS = 8;
  const HOLD_MS = 25;
  const intervals = [];

  await Promise.all(
    Array.from({ length: HOLDERS }, () => async () => {
      const release = await acquire();
      const enter = Date.now();
      await sleep(HOLD_MS);
      const exit = Date.now();
      intervals.push([enter, exit]);
      release();
    }).map((run) => run()),
  );

  assert.equal(intervals.length, HOLDERS, 'every holder should have run');

  intervals.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < intervals.length; i += 1) {
    const [, previousExit] = intervals[i - 1];
    const [currentEnter] = intervals[i];
    assert.ok(
      currentEnter >= previousExit,
      `holder ${i} entered at ${currentEnter} before holder ${i - 1} exited at ${previousExit}`,
    );
  }
});

test('a lock held by a dead process is reclaimed', async () => {
  // pid 999999 is far above the default pid_max and is not running.
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999, at: Date.now() }));

  const release = await Promise.race([
    acquire(),
    sleep(3000).then(() => {
      throw new Error('acquire blocked on a lock owned by a dead process');
    }),
  ]);

  const holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  assert.equal(holder.pid, process.pid, 'lock should now be ours');
  release();
});

test('a corrupt lock file is reclaimed', async () => {
  fs.writeFileSync(LOCK_PATH, 'this is not json');

  const release = await Promise.race([
    acquire(),
    sleep(3000).then(() => {
      throw new Error('acquire blocked on a corrupt lock file');
    }),
  ]);

  release();
  assert.ok(!fs.existsSync(LOCK_PATH));
});

test('a lock older than the stale window is reclaimed even if the pid is alive', async () => {
  // Our own pid is alive, so only the age check can release this one.
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, at: 0 }));

  const release = await Promise.race([
    acquire(),
    sleep(3000).then(() => {
      throw new Error('acquire blocked on a lock past the stale window');
    }),
  ]);

  release();
});
