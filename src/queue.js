import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * One lock per machine by default, so every saynow process shares a queue
 * regardless of whether it came from npm or pip. Override to give a project
 * or test its own independent queue.
 */
const LOCK_PATH =
  process.env.SAYNOW_LOCK_PATH || path.join(os.tmpdir(), 'saynow.lock');
const POLL_MS = 60;
const STALE_MS = 5 * 60 * 1000;
/** A lock younger than this is never reclaimed — it may still be mid-creation. */
const GRACE_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
};

function clearIfStale() {
  let stats;
  try {
    stats = fs.statSync(LOCK_PATH);
  } catch {
    return;
  }

  // The holder creates the file and writes to it as two steps, so for a moment
  // it is empty. Treating that as corrupt and deleting it would hand the lock
  // to a second process while the first still holds it — both would then speak
  // at once. Never reclaim a lock young enough to still be mid-creation.
  if (Date.now() - stats.mtimeMs < GRACE_MS) return;

  let holder;
  try {
    holder = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    // Old and unreadable: its owner died before finishing.
    fs.rmSync(LOCK_PATH, { force: true });
    return;
  }

  const expired = Date.now() - (holder.at ?? 0) > STALE_MS;
  if (expired || !isAlive(holder.pid)) {
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

/**
 * Serialize playback across concurrent `saynow` invocations. An agent firing
 * three updates in a row should hear three sentences, not one muddle.
 *
 * Returns a release function. Always call it in a finally block.
 */
export async function acquire({ timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);

      let released = false;
      return () => {
        if (released) return;
        released = true;
        fs.rmSync(LOCK_PATH, { force: true });
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      clearIfStale();
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for another saynow to finish speaking (lock: ${LOCK_PATH}).\n` +
            `Pass --no-queue to speak immediately without waiting.`,
        );
      }
      await sleep(POLL_MS);
    }
  }
}
