import assert from 'node:assert/strict';
import { test } from 'node:test';

import { render, speech } from '../src/markdown.js';

/**
 * The text rendered here is written by an agent, and it lands in a page that
 * holds endpoints able to answer questions on the user's behalf. So the bar is
 * not "renders Markdown" but "cannot be made to emit anything executable".
 */

/** Tags the renderer builds. Anything else means source text became markup. */
const ALLOWED = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'del', 'code', 'pre', 'a', 'img',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'br',
]);

function audit(html) {
  const problems = [];
  for (const match of html.matchAll(/<\/?([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, name, attrs] = match;
    if (!ALLOWED.has(name.toLowerCase())) problems.push(`unexpected <${name}>`);
    for (const attr of attrs.matchAll(/([a-zA-Z-]+)\s*=/g)) {
      if (/^on/i.test(attr[1])) problems.push(`event handler ${attr[1]} on <${name}>`);
    }
    if (/javascript:/i.test(attrs)) problems.push(`javascript: url on <${name}>`);
  }
  return problems;
}

const ATTACKS = [
  ['a raw script tag', '<script>fetch("/reply",{method:"POST"})</script>'],
  ['an inline event handler', '<img src=x onerror=alert(1)>'],
  ['an svg load handler', '<svg onload=alert(1)>'],
  ['an iframe', '<iframe src=//evil.example></iframe>'],
  ['a javascript: link', '[click me](javascript:alert(1))'],
  ['a javascript: image', '![x](javascript:alert(1))'],
  ['a data:text/html link', '[click](data:text/html,<script>alert(1)</script>)'],
  ['a double-quote breakout', '[x](https://a.example"onmouseover="alert(1))'],
  ['a single-quote breakout', "[x](https://a.example'onmouseover='alert(1))"],
  ['html inside a code fence', '```\n<script>alert(1)</script>\n```'],
  ['html inside inline code', '`<img src=x onerror=alert(1)>`'],
  ['html inside a table cell', '| a |\n| --- |\n| <script>alert(1)</script> |'],
  ['html inside a heading', '# <script>alert(1)</script>'],
  ['html inside a list item', '- <script>alert(1)</script>'],
];

for (const [name, input] of ATTACKS) {
  test(`${name} renders inert`, () => {
    assert.deepEqual(audit(render(input)), [], `input: ${input}`);
  });
}

test('an ordinary link survives, with query strings intact', () => {
  const html = render('[report](https://example.com/r?a=1&b=2)');
  assert.match(html, /href="https:\/\/example\.com\/r\?a=1&amp;b=2"/);
  assert.match(html, /rel="noreferrer noopener"/, 'external links must not leak the opener');
  assert.deepEqual(audit(html), []);
});

test('a relative image is resolved through the caller, never trusted raw', () => {
  const asked = [];
  const html = render('![chart](charts/q3.png)', {
    asset: (src) => {
      asked.push(src);
      return `/asset?p=${encodeURIComponent(src)}`;
    },
  });
  assert.deepEqual(asked, ['charts/q3.png']);
  assert.match(html, /<img src="\/asset\?p=charts%2Fq3\.png"/);
});

test('an image with an unknown scheme is dropped, keeping its alt text', () => {
  const html = render('![the chart](ftp://example.com/x.png)', { asset: () => null });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /the chart/, 'the description should survive even when the image cannot');
});

test('structure renders as structure', () => {
  const html = render('# Title\n\n- one\n- two\n\n> quoted\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  for (const tag of ['<h1>', '<ul>', '<li>', '<blockquote>', '<table>', '<th>', '<td>']) {
    assert.ok(html.includes(tag), `expected ${tag}`);
  }
});

test('speech keeps the prose and drops what cannot be heard', () => {
  const spoken = speech(
    '# Title\n\nSee the [full report](https://example.com/very/long/url).\n\n' +
      '![a chart](chart.png)\n\n```\nnpm install --global\n```\n\n- one\n- two',
  );

  assert.match(spoken, /Title/);
  assert.match(spoken, /full report/, 'link text is worth hearing');
  assert.doesNotMatch(spoken, /example\.com/, 'a URL read aloud is noise');
  assert.doesNotMatch(spoken, /chart\.png/, 'an image cannot be spoken');
  assert.doesNotMatch(spoken, /npm install/, 'a code block read aloud is unintelligible');
  assert.match(spoken, /one two/, 'list items are prose');
  assert.doesNotMatch(spoken, /[#*`>]/, 'no markup should survive into speech');
});
