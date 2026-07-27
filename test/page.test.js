import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createDom } from './helpers/dom.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = fs.readFileSync(path.join(ROOT, 'ui', 'bubble.html'), 'utf8');

const SCRIPT = /<script>([\s\S]*)<\/script>\s*<\/body>/.exec(PAGE)?.[1];
assert.ok(SCRIPT, 'could not find the page script — did the markup change?');

/**
 * Run the page against a stub DOM and hand back what it built.
 *
 * Three of this project's bugs lived in this script and every one was found
 * by a person noticing an inert bubble: a const referenced from above its
 * declaration threw before a single handler was bound, twice. Nothing here
 * needs a browser to catch that — it only needs the script to actually run.
 */
function loadPage(state) {
  const { document, byId, search } = createDom({ markup: PAGE });
  const calls = { fetched: [], audio: [], players: [], events: [] };

  const context = {
    window: {
      __SAYNOW__: state,
      addEventListener() {},
      webkit: undefined,
    },
    document,
    location: { search },
    fetch: (url, init) => {
      calls.fetched.push({ url, init });
      return Promise.resolve({ ok: true });
    },
    Audio: class {
      constructor(src) {
        calls.audio.push(src);
        calls.players.push(this);
        this.src = src;
        this.paused = false;
        this.ended = false;
        this.currentTime = 0;
        this.duration = 0;
      }
      addEventListener(type, handler) {
        (this.handlers ??= {})[type] = handler;
      }
      play() {
        return Promise.resolve();
      }
      pause() {
        this.paused = true;
      }
      load() {}
    },
    EventSource: class {
      constructor(url) {
        calls.events.push(url);
      }
      addEventListener() {}
    },
    requestAnimationFrame: (fn) => {
      fn();
      return 1;
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    ResizeObserver: class {
      observe() {}
    },
    URLSearchParams,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    console,
  };

  context.window.document = document;

  const run = new Function(...Object.keys(context), SCRIPT);
  run(...Object.values(context));

  return { document, byId, calls };
}

const PLAIN = { text: 'The build finished, 42 tests passed.', ask: false, rate: 175, dismissMs: 5000 };

test('the page runs to completion on a plain announcement', () => {
  // The whole point: if the script throws, nothing below is bound and the
  // bubble opens inert with a close button that does nothing.
  assert.doesNotThrow(() => loadPage(PLAIN));
});

test('dismissal is wired even though everything else could fail', () => {
  const { byId, document } = loadPage(PLAIN);
  assert.ok(byId.get('close').hasListener('click'), 'the close button must be clickable');
  assert.ok(document.hasListener('keydown'), 'Escape must be handled');
});

test('clicking close asks the CLI to dismiss', () => {
  const { byId, calls } = loadPage(PLAIN);
  byId.get('close').dispatch('click');
  const paths = calls.fetched.map((c) => c.url);
  assert.ok(
    paths.some((p) => p.includes('/dismiss')),
    `expected a dismiss request, saw ${JSON.stringify(paths)}`,
  );
});

test('every request carries the token', () => {
  const { byId, calls } = loadPage(PLAIN);
  byId.get('close').dispatch('click');
  for (const { url, init } of calls.fetched) {
    const carried =
      url.includes('t=testtoken') || init?.headers?.['X-Saynow-Token'] === 'testtoken';
    assert.ok(carried, `request to ${url} went out without the token`);
  }
});

test('the transcript is split into one element per word', () => {
  const { byId } = loadPage(PLAIN);
  const words = byId.get('transcript').children.filter((c) => c.tagName === 'W');
  assert.equal(words.length, PLAIN.text.split(/\s+/).length);
  assert.equal(words[0].textContent, 'The');
});

test('the reply box appears only when an answer is wanted', () => {
  const plain = loadPage(PLAIN);
  assert.ok(plain.byId.get('reply').classList.contains('hidden'), 'no reply box without --ask');

  const asking = loadPage({ ...PLAIN, ask: true });
  assert.ok(!asking.byId.get('reply').classList.contains('hidden'), '--ask must show one');
});

test('a named sender replaces the wordmark', () => {
  const { byId } = loadPage({ ...PLAIN, from: 'noclick1 · billing' });
  const label = byId.get('label');
  assert.match(label.textContent, /noclick1/);
  assert.ok(label.classList.contains('named'), 'a name is styled differently from the wordmark');
});

test('audio is played by the page, with the token attached', () => {
  const { calls } = loadPage({ ...PLAIN, hasAudio: true });
  assert.equal(calls.audio.length, 1);
  assert.match(calls.audio[0], /^\/audio\?t=testtoken/);
});

test('chunked speech starts the first clip and preloads the next', () => {
  const { calls } = loadPage({
    ...PLAIN,
    text: 'One two three. Four five six.',
    chunks: [
      { firstWord: 0, wordCount: 3 },
      { firstWord: 3, wordCount: 3 },
    ],
  });
  assert.match(calls.audio[0], /^\/audio\/0\?t=testtoken/);
  assert.match(calls.audio[1], /^\/audio\/1\?t=testtoken/, 'the next clip should be warmed');
});

test('a rendered document keeps its structure and still lights word by word', () => {
  const { byId } = loadPage({
    ...PLAIN,
    text: 'Morning summary Rates held steady',
    html: '<h1>Morning summary</h1><ul><li>Rates held steady</li></ul>',
  });

  const transcript = byId.get('transcript');
  assert.ok(transcript.classList.contains('rich'));
  assert.equal(transcript.children[0].tagName, 'H1', 'structure must survive');

  const words = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.tagName === 'W') words.push(child.textContent);
      else walk(child);
    }
  };
  walk(transcript);
  assert.deepEqual(words, ['Morning', 'summary', 'Rates', 'held', 'steady']);
});

test('code blocks are never lit, because they are never spoken', () => {
  const { byId } = loadPage({
    ...PLAIN,
    text: 'Run this',
    html: '<p>Run this</p><pre><code>npm install --global saynow</code></pre>',
  });

  const inPre = [];
  const walk = (node, insidePre) => {
    for (const child of node.children ?? []) {
      const nowInside = insidePre || child.tagName === 'PRE';
      if (child.tagName === 'W' && nowInside) inPre.push(child.textContent);
      walk(child, nowInside);
    }
  };
  walk(byId.get('transcript'), false);
  assert.deepEqual(inPre, [], 'wrapping code would desynchronise everything after it');
});

test('the countdown runs after a question, not only after a statement', () => {
  // The page focuses the reply box itself on load, and holding() counted that
  // as engagement — so with --ask the countdown never started, the bar never
  // appeared, and the bubble sat there until the CLI gave up. It looked like
  // the timer only worked without --ask, which is exactly what it did.
  const { byId, calls } = loadPage({ ...PLAIN, ask: true, hasAudio: true });

  const player = calls.players[0];
  assert.ok(player, 'the page should be playing the audio itself');
  player.handlers.ended();

  const bar = byId.get('timer');
  assert.equal(bar.style.transform, 'scaleX(0)', 'the bar must be counting down');
  assert.match(bar.style.transition, /^transform \d+ms linear$/);
});

test('a question is given longer to answer than a statement takes to hear', () => {
  const read = (state) => {
    const { byId, calls } = loadPage({ ...state, hasAudio: true });
    calls.players[0].handlers.ended();
    return Number(/transform (\d+)ms/.exec(byId.get('timer').style.transition)?.[1]);
  };

  assert.ok(
    read({ ...PLAIN, ask: true, dismissMs: 20000 }) >
      read({ ...PLAIN, ask: false, dismissMs: 5000 }),
    'five seconds is not long enough to read a question and type an answer',
  );
});

test('hovering holds the bubble open, and leaving restarts the countdown', () => {
  const { byId, calls } = loadPage({ ...PLAIN, ask: true, hasAudio: true });
  calls.players[0].handlers.ended();

  const bubble = byId.get('bubble');
  const bar = byId.get('timer');

  bubble.dispatch('mouseenter');
  assert.equal(bar.style.opacity, '0', 'the bar should fade out while they are here');

  bubble.dispatch('mouseleave');
  assert.equal(bar.style.transform, 'scaleX(0)');
  assert.equal(bar.style.opacity, '1', 'and come back when they leave');
});

test('the cursor landing in the box on its own does not hold the bubble open', () => {
  // The page focuses the reply field itself, and WebKit may deliver that
  // focus event whenever it likes. Treating focus as engagement is what
  // killed the countdown for every --ask bubble.
  const { byId, calls } = loadPage({ ...PLAIN, ask: true, hasAudio: true });
  byId.get('field').dispatch('focus');
  calls.players[0].handlers.ended();

  assert.equal(byId.get('timer').style.transform, 'scaleX(0)', 'it must still count down');
});

test('reaching for the box does hold it open', () => {
  const { byId, calls } = loadPage({ ...PLAIN, ask: true, hasAudio: true });
  byId.get('field').dispatch('pointerdown');
  calls.players[0].handlers.ended();

  assert.notEqual(byId.get('timer').style.transform, 'scaleX(0)');
});

test('a reply in progress is never swallowed by the timer', () => {
  const { byId, calls } = loadPage({ ...PLAIN, ask: true, hasAudio: true });
  const field = byId.get('field');

  field.value = 'not yet, wait';
  field.dispatch('input');
  calls.players[0].handlers.ended();

  byId.get('bubble').dispatch('mouseenter');
  byId.get('bubble').dispatch('mouseleave');
  assert.notEqual(
    byId.get('timer').style.transform,
    'scaleX(0)',
    'losing a half-written reply is worse than a bubble that overstays',
  );
});

/**
 * There is deliberately no static check for use-before-declaration here.
 *
 * A regex cannot see scope: the first attempt flagged the parameters of
 * litUpTo(count) and followAudio(audio, chunk) as references to consts
 * declared further down. A test that cries wolf gets muted, and then it
 * protects nothing. "The page runs to completion" above already catches the
 * temporal dead zone definitively, because that is exactly how it fails.
 */
