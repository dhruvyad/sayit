/**
 * Split text into speakable chunks.
 *
 * A long read synthesised in one call is silent until the whole thing is
 * rendered — fifteen seconds of nothing before a daily-news summary starts
 * talking. Splitting on sentences lets the first one play while the rest are
 * still being made, so speech begins in about a second regardless of length.
 *
 * Chunks carry the index of their first word so the transcript can keep
 * highlighting across the seam without recounting.
 */

/** Long enough to sound natural, short enough that the first one is quick. */
const TARGET_CHARS = 320;

/**
 * The first chunk is deliberately tiny and later ones grow.
 *
 * Time to first word is what a listener actually feels, and synthesis latency
 * tracks the length of the request. A small opener starts the speech in a
 * couple of seconds; by the time it finishes, the longer chunks behind it are
 * already rendered, so the ramp costs nothing audible.
 */
const FIRST_CHARS = 90;

/** Below this, splitting costs more in round trips than it saves in latency. */
export const MIN_CHARS_TO_SPLIT = 260;

export function chunk(text, { targetChars = TARGET_CHARS } = {}) {
  const words = text.split(/\s+/).filter(Boolean);

  if (text.length < MIN_CHARS_TO_SPLIT) {
    return [{ text, firstWord: 0, wordCount: words.length }];
  }

  // Keep the punctuation with the sentence it ends: a chunk read without its
  // full stop is spoken with the wrong intonation.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';

  // Grows from a quick opener up to the steady-state size.
  const limitFor = (index) =>
    Math.min(targetChars, FIRST_CHARS * Math.pow(2, index));

  const flush = () => {
    if (!current) return;
    const count = current.split(/\s+/).filter(Boolean).length;
    const firstWord = chunks.reduce((sum, c) => sum + c.wordCount, 0);
    chunks.push({ text: current, firstWord, wordCount: count });
    current = '';
  };

  for (const sentence of sentences) {
    const limit = limitFor(chunks.length);

    if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= limit) {
      current += ` ${sentence}`;
    } else {
      flush();
      current = sentence;
    }

    // A single sentence longer than the limit still has to go out on its own;
    // splitting mid-sentence would be audible.
    if (current.length >= limit) flush();
  }
  flush();

  return chunks.length ? chunks : [{ text, firstWord: 0, wordCount: words.length }];
}
