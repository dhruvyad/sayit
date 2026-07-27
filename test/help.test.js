import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CANONICAL = path.join(ROOT, 'help.txt');
const PYTHON_COPY = path.join(ROOT, 'python', 'src', 'saynow', 'help.txt');

const run = (...args) =>
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'saynow.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, SAYNOW_CONFIG_DIR: path.join(ROOT, '.no-such-config') },
  });

test('the Python package ships the same help text as npm', () => {
  assert.equal(
    fs.readFileSync(PYTHON_COPY, 'utf8'),
    fs.readFileSync(CANONICAL, 'utf8'),
    'python/src/saynow/help.txt has drifted from help.txt — copy it across',
  );
});

test('every placeholder in help.txt is substituted', () => {
  const rendered = run('--help');
  const leftovers = rendered.match(/\{\{[A-Z_]+\}\}/g);
  assert.equal(leftovers, null, `unsubstituted placeholders: ${leftovers}`);
});

test('help documents every flag the parser accepts', () => {
  const source = fs.readFileSync(path.join(ROOT, 'bin', 'saynow.js'), 'utf8');
  const optionsBlock = source.slice(source.indexOf('const OPTIONS = {'));
  const declared = [...optionsBlock.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);

  assert.ok(declared.length >= 10, `expected to find the option table, got ${declared}`);

  const rendered = run('--help');
  for (const flag of declared) {
    assert.ok(
      rendered.includes(`--${flag}`),
      `--${flag} is accepted but never documented in help.txt`,
    );
  }
});

test('the man page documents every flag and stays on the current version', () => {
  const man = fs.readFileSync(path.join(ROOT, 'man', 'saynow.1'), 'utf8');
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  assert.ok(
    man.includes(`saynow ${version}`),
    `man page header is stale — bump it to ${version}`,
  );

  const source = fs.readFileSync(path.join(ROOT, 'bin', 'saynow.js'), 'utf8');
  const optionsBlock = source.slice(source.indexOf('const OPTIONS = {'));
  const declared = [...optionsBlock.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);

  for (const flag of declared) {
    // roff escapes hyphens as \-, so compare against a normalised copy.
    assert.ok(
      man.replace(/\\-/g, '-').includes(`--${flag}`),
      `--${flag} is accepted but missing from the man page`,
    );
  }
});

test('help documents every subcommand and provider', () => {
  const rendered = run('--help');
  for (const command of ['init', 'config', 'voices', 'models', 'help']) {
    assert.ok(rendered.includes(command), `subcommand "${command}" is undocumented`);
  }
  for (const provider of ['system', 'openai', 'elevenlabs', 'openrouter']) {
    assert.ok(rendered.includes(provider), `provider "${provider}" is undocumented`);
  }
});
