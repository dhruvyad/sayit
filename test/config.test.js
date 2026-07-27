import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const sandbox = path.join(os.tmpdir(), `sayit-test-${process.pid}`);
process.env.SAYIT_CONFIG_DIR = sandbox;

const { CONFIG_PATH, DEFAULTS, load, redact, resolve, save } = await import('../src/config.js');
const { get, providerIds } = await import('../src/providers/index.js');

before(() => fs.rmSync(sandbox, { recursive: true, force: true }));
after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('load returns defaults when no config file exists', () => {
  assert.deepEqual(load(), DEFAULTS);
});

test('save writes 0600 and round-trips', () => {
  save({ ...DEFAULTS, provider: 'openai', openaiApiKey: 'sk-secret' });

  const mode = fs.statSync(CONFIG_PATH).mode & 0o777;
  assert.equal(mode, 0o600, 'config file must not be world or group readable');

  const loaded = load();
  assert.equal(loaded.provider, 'openai');
  assert.equal(loaded.openaiApiKey, 'sk-secret');
});

test('resolve layers file < env < flags', () => {
  save({ ...DEFAULTS, provider: 'openai', voice: 'alloy' });

  assert.equal(resolve().voice, 'alloy', 'file value applies');

  process.env.SAYIT_VOICE = 'nova';
  assert.equal(resolve().voice, 'nova', 'env overrides file');

  assert.equal(resolve({ voice: 'sage' }).voice, 'sage', 'flags override env');
  assert.equal(resolve({ voice: undefined }).voice, 'nova', 'undefined flags are ignored');

  delete process.env.SAYIT_VOICE;
});

test('redact never reveals a full key', () => {
  assert.equal(redact('short'), '****');
  assert.ok(!redact('sk-abcdefghijklmnop').includes('efghijkl'));
});

test('every registered provider exposes the expected shape', () => {
  for (const id of providerIds) {
    const p = get(id);
    assert.equal(typeof p.id, 'string', `${id} has an id`);
    assert.equal(typeof p.label, 'string', `${id} has a label`);
    assert.equal(typeof p.voices, 'function', `${id} can list voices`);
    if (p.speaksDirectly) {
      assert.equal(typeof p.speak, 'function', `${id} implements speak`);
    } else {
      assert.equal(typeof p.synthesize, 'function', `${id} implements synthesize`);
      assert.equal(typeof p.envVar, 'string', `${id} declares an env var`);
      assert.equal(typeof p.configKey, 'string', `${id} declares a config key`);
    }
  }
});

test('get rejects unknown providers', () => {
  assert.throws(() => get('nope'), /unknown provider/);
});
