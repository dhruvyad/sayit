import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_PATH = path.join(os.tmpdir(), 'saynow.lock');
const POLL_MS = 60;
const STALE_MS = 5 * 60 * 1000;

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
  let raw;
  try {
    raw = fs.readFileSync(LOCK_PATH, 'utf8');
  } catch {
    return;
  }

  let holder;
  try {
    holder = JSON.parse(raw);
  } catch {
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
