import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Synthesised audio is worth keeping. Reading a long article costs real money
 * and real seconds, and losing it to a closed terminal means paying both
 * again — so every cloud synthesis is archived here and pruned by count.
 */
export const HISTORY_DIR =
  process.env.SAYNOW_HISTORY_DIR ||
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'saynow', 'history')
    : path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
        'saynow',
        'history',
      ));

const INDEX_PATH = path.join(HISTORY_DIR, 'index.json');

export const DEFAULT_LIMIT = 50;

export function readIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries) {
  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Archive one synthesis. Returns the entry, or null when history is disabled.
 * Never throws: losing the archive must not stop saynow from speaking.
 */
export function record({
  audio,
  ext,
  text,
  provider,
  model,
  voice,
  generationId,
  limit = DEFAULT_LIMIT,
} = {}) {
  if (!limit || limit < 1 || !audio?.length) return null;

  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true, mode: 0o700 });

    const at = new Date();
    const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const digest = createHash('sha256').update(audio).digest('hex').slice(0, 8);
    const file = `${stamp}-${digest}.${ext}`;

    fs.writeFileSync(path.join(HISTORY_DIR, file), audio, { mode: 0o600 });

    const entry = {
      file,
      at: at.toISOString(),
      bytes: audio.length,
      provider,
      model: model ?? null,
      voice: voice ?? null,
      // Resolved lazily by `saynow history` so synthesis is never delayed by
      // a second round trip just to learn the price.
      generationId: generationId ?? null,
      cost: null,
      // Enough to recognise the clip without bloating the index with essays.
      text: text.length > 300 ? `${text.slice(0, 300)}…` : text,
    };

    const entries = [entry, ...readIndex()];
    prune(entries, limit);
    writeIndex(entries.slice(0, limit));

    return entry;
  } catch {
    return null;
  }
}

/** Delete the audio for everything past the limit. Mutates nothing on disk otherwise. */
function prune(entries, limit) {
  for (const stale of entries.slice(limit)) {
    fs.rmSync(path.join(HISTORY_DIR, stale.file), { force: true });
  }
}

/**
 * Fill in prices for clips that have a generation id but no cost yet, then
 * persist. Returns how many were resolved.
 */
/** Accept either spelling: older clips were written with a snake_case key. */
const generationIdOf = (entry) => entry.generationId ?? entry.generation_id ?? null;

export async function resolveCosts(lookup) {
  const entries = readIndex();
  // Null means "not priced yet"; zero is a real price, which a generation
  // that produced no audio genuinely has. Retrying zeros would re-query them
  // on every listing, forever.
  const pending = entries.filter((e) => generationIdOf(e) && e.cost == null);
  if (!pending.length) return 0;

  const results = await Promise.all(
    pending.map((entry) => lookup(generationIdOf(entry)).catch(() => null)),
  );

  let resolved = 0;
  pending.forEach((entry, i) => {
    if (results[i] != null) {
      entry.cost = results[i];
      resolved += 1;
    }
  });

  if (resolved) {
    try {
      writeIndex(entries);
    } catch {
      /* a read-only archive is not worth failing over */
    }
  }
  return resolved;
}

export function totalCost() {
  return readIndex().reduce((sum, e) => sum + (e.cost || 0), 0);
}

export function clear() {
  const entries = readIndex();
  for (const entry of entries) {
    fs.rmSync(path.join(HISTORY_DIR, entry.file), { force: true });
  }
  fs.rmSync(INDEX_PATH, { force: true });
  return entries.length;
}

/** Total bytes currently archived, for reporting. */
export function usage() {
  return readIndex().reduce((total, entry) => total + (entry.bytes || 0), 0);
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
