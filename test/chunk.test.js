import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chunk, MIN_CHARS_TO_SPLIT } from '../src/chunk.js';

const LONG = [
  'Attention normally scores every token against every other one, which is quadratic and gets expensive fast.',
  'A lightning indexer scores all of them first using a much cheaper function, then keeps only the top candidates.',
  'It uses thirty-two small heads, one shared key per token, and a ReLU, picked because it is cheap.',
  'The catch is that the indexer is still quadratic.',
  'It just has a far smaller constant, so it wins as context grows.',
].join(' ');

test('short text is left whole', () => {
  const pieces = chunk('The build finished, 42 tests passed.');
  assert.equal(pieces.length, 1, 'splitting short text costs round trips and saves nothing');
  assert.equal(pieces[0].firstWord, 0);
});

test('text just under the threshold is left whole', () => {
  const text = `${'word '.repeat(40)}end.`.trim();
  assert.ok(text.length < MIN_CHARS_TO_SPLIT);
  assert.equal(chunk(text).length, 1);
});

test('long text is split on sentence boundaries', () => {
  const pieces = chunk(LONG);
  assert.ok(pieces.length > 1, 'long text should split');

  for (const piece of pieces) {
    assert.ok(
      /[.!?]$/.test(piece.text.trim()),
      `chunk should end on a sentence: "${piece.text.slice(-40)}"`,
    );
  }
});

test('the first chunk is the smallest, so speech starts soonest', () => {
  const pieces = chunk(LONG);
  const biggest = Math.max(...pieces.map((p) => p.text.length));
  assert.ok(
    pieces[0].text.length < biggest,
    'the opener must be shorter than the steady-state size',
  );
  assert.ok(pieces[0].text.length <= 180, 'the opener should be genuinely small');
});

test('chunks reassemble into the original words, in order', () => {
  const pieces = chunk(LONG);
  const rejoined = pieces.map((p) => p.text).join(' ');
  assert.deepEqual(
    rejoined.split(/\s+/).filter(Boolean),
    LONG.split(/\s+/).filter(Boolean),
    'no word may be lost or duplicated at a seam',
  );
});

test('word indices are contiguous and cover every word', () => {
  const pieces = chunk(LONG);
  const total = LONG.split(/\s+/).filter(Boolean).length;

  let expected = 0;
  for (const piece of pieces) {
    // The transcript highlights across seams using these, so a gap or an
    // overlap would make words light up twice or never.
    assert.equal(piece.firstWord, expected, 'chunks must be contiguous');
    expected += piece.wordCount;
  }
  assert.equal(expected, total, 'chunks must cover the whole transcript');
});

test('a single sentence longer than the target still goes out alone', () => {
  const monster = `${'clause '.repeat(80)}end.`.trim();
  const pieces = chunk(monster);
  assert.ok(pieces.length >= 1);
  assert.equal(
    pieces.map((p) => p.text).join(' ').split(/\s+/).length,
    monster.split(/\s+/).length,
    'splitting mid-sentence would be audible, so it must stay intact',
  );
});
