import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sandbox = path.join(os.tmpdir(), `saynow-history-test-${process.pid}`);
process.env.SAYNOW_HISTORY_DIR = sandbox;

const history = await import('../src/history.js');

after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

const clip = (over = {}) => ({
  audio: Buffer.from('fake audio bytes'),
  ext: 'wav',
  text: 'hello',
  provider: 'openrouter',
  ...over,
});

test('a recorded clip keeps its generation id', () => {
  const entry = history.record(clip({ generationId: 'gen-abc' }));
  assert.equal(entry.generationId, 'gen-abc');
  assert.equal(entry.cost, null, 'cost is resolved later, not at record time');
});

test('costs resolve for the key this build writes', async () => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  history.record(clip({ generationId: 'gen-written-by-npm' }));

  const asked = [];
  const resolved = await history.resolveCosts(async (id) => {
    asked.push(id);
    return 0.0042;
  });

  assert.equal(resolved, 1);
  assert.deepEqual(asked, ['gen-written-by-npm']);
  assert.equal(history.readIndex()[0].cost, 0.0042);
});

test('costs resolve for a clip the pip build wrote', async () => {
  // The two builds share one index file. They previously disagreed on the key
  // name, so neither could price the other's clips and the app priced none of
  // them. Readers must accept both spellings.
  fs.rmSync(sandbox, { recursive: true, force: true });
  history.record(clip({ generationId: 'gen-ignored' }));

  const index = path.join(sandbox, 'index.json');
  const entries = JSON.parse(fs.readFileSync(index, 'utf8'));
  delete entries[0].generationId;
  entries[0].generation_id = 'gen-written-by-pip';
  fs.writeFileSync(index, JSON.stringify(entries));

  const asked = [];
  const resolved = await history.resolveCosts(async (id) => {
    asked.push(id);
    return 0.001;
  });

  assert.equal(resolved, 1, 'a snake_case id must still be priced');
  assert.deepEqual(asked, ['gen-written-by-pip']);
});

test('every reader of the archive agrees on the key name', () => {
  const sources = {
    'python/src/saynow/history.py': fs.readFileSync(
      path.join(ROOT, 'python/src/saynow/history.py'),
      'utf8',
    ),
    'app/Sources/HistoryStore.swift': fs.readFileSync(
      path.join(ROOT, 'app/Sources/HistoryStore.swift'),
      'utf8',
    ),
  };

  for (const [file, source] of Object.entries(sources)) {
    assert.ok(
      source.includes('generationId'),
      `${file} must read the camelCase key the npm build writes`,
    );
    assert.ok(
      source.includes('generation_id'),
      `${file} must still accept the older snake_case key`,
    );
  }
});

test('a clip without a generation id is skipped rather than queried', async () => {
  fs.rmSync(sandbox, { recursive: true, force: true });
  history.record(clip()); // the system voice never produces one

  let called = false;
  const resolved = await history.resolveCosts(async () => {
    called = true;
    return 1;
  });

  assert.equal(resolved, 0);
  assert.equal(called, false, 'nothing to look up means no request');
});
