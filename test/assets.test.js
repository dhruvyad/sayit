import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { render } from '../src/markdown.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The pip build ships its own copies of the page and the panel rather than
 * reimplementing them, so both builds show the same bubble. Copies drift
 * silently: a fix to ui/bubble.html would land for npm users and quietly skip
 * everyone on pip, and nothing would fail until someone compared screenshots.
 */
const COPIES = [
  ['ui/bubble.html', 'python/src/saynow/bubble.html'],
  ['shell/SaynowPanel.swift', 'python/src/saynow/SaynowPanel.swift'],
];

for (const [source, copy] of COPIES) {
  test(`${copy} matches ${source}`, () => {
    assert.equal(
      fs.readFileSync(path.join(ROOT, copy), 'utf8'),
      fs.readFileSync(path.join(ROOT, source), 'utf8'),
      `${copy} has drifted — copy ${source} across`,
    );
  });
}

test('the python package declares no dependency it cannot install', () => {
  // The page and panel are data files, not modules. hatchling ships whatever
  // sits inside the package directory, so they only need to live there — but
  // if the layout ever changes, --ask on pip breaks at runtime rather than at
  // build time.
  const pyproject = fs.readFileSync(path.join(ROOT, 'python', 'pyproject.toml'), 'utf8');
  assert.match(pyproject, /packages = \["src\/saynow"\]/);

  for (const [, copy] of COPIES) {
    assert.ok(
      copy.startsWith('python/src/saynow/'),
      `${copy} must sit inside the package to be installed`,
    );
  }
});

test('the shared fixture still renders the way it is recorded', () => {
  // test/fixtures/document.html is the agreement between the two renderers:
  // python/tests/test_markdown.py asserts the same bytes. Pinning it here
  // keeps the fixture honest, so a change to either renderer has to be made
  // in both or the other one fails.
  const markdown = fs.readFileSync(path.join(ROOT, 'test/fixtures/document.md'), 'utf8');
  const expected = fs.readFileSync(path.join(ROOT, 'test/fixtures/document.html'), 'utf8');

  const html = render(markdown, {
    asset: (src) => (/^[a-z][\w+.-]*:/i.test(src) ? null : `/asset?p=${encodeURIComponent(src)}`),
  });
  assert.equal(`${html}\n`, expected);
});
