import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * OpenRouter publishes a `supported_voices` list on every speech model, so
 * voice names come from the API rather than a table in this repo. A hardcoded
 * table was not merely incomplete, it was wrong: Grok's voice is "eve", not
 * "Eve", and Deepgram has 90 voices rather than the 9 that guessing found.
 *
 * The catalogue is cached on disk so the common path costs nothing, and a
 * small built-in fallback keeps saynow usable offline.
 */
const CATALOG_URL = 'https://openrouter.ai/api/v1/models?output_modalities=speech';

const CACHE_DIR =
  process.env.SAYNOW_CACHE_DIR ||
  (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Caches', 'saynow')
    : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'saynow'));

const CACHE_PATH = path.join(CACHE_DIR, 'speech-models.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Enough to speak without a network round trip on a cold cache. */
const FALLBACK = {
  'google/gemini-3.1-flash-tts-preview': ['Zephyr', 'Puck', 'Charon', 'Kore'],
  'deepgram/aura-2': ['aura-2-thalia-en'],
  'x-ai/grok-voice-tts-1.0': ['eve', 'ara', 'rex', 'sal', 'leo'],
  'hexgrad/kokoro-82m': ['af_heart', 'af_bella'],
  // Reported by the API as having no voice list, but this one is accepted.
  'minimax/speech-2.8-turbo': ['alloy'],
  'minimax/speech-2.8-hd': ['alloy'],
};

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    if (!Array.isArray(raw.models)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(models) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ at: Date.now(), models }));
  } catch {
    /* a warm cache is an optimisation, never a requirement */
  }
}

async function fetchCatalog() {
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
  const { data } = await res.json();

  return data.map((m) => ({
    id: m.id,
    price: Number(m.pricing?.prompt ?? 0),
    voices: Array.isArray(m.supported_voices) ? m.supported_voices : [],
  }));
}

/**
 * The speech-model catalogue, from cache when fresh.
 * `refresh: true` always goes to the network; failures fall back to whatever
 * is cached rather than leaving the caller with nothing.
 */
export async function catalog({ refresh = false } = {}) {
  const cached = readCache();
  const fresh = cached && Date.now() - cached.at < MAX_AGE_MS;

  if (!refresh && fresh) return cached.models;

  try {
    const models = await fetchCatalog();
    writeCache(models);
    return models;
  } catch {
    return cached?.models ?? [];
  }
}

/** Voices for a model without touching the network. */
export function cachedVoices(model) {
  const cached = readCache();
  const entry = cached?.models.find((m) => m.id === model);
  if (entry?.voices.length) return entry.voices;
  return FALLBACK[model] ?? [];
}

export async function voicesFor(model) {
  const models = await catalog();
  const entry = models.find((m) => m.id === model);
  if (entry?.voices.length) return entry.voices;
  return FALLBACK[model] ?? [];
}

export function defaultVoice(model) {
  return cachedVoices(model)[0] ?? null;
}

export { FALLBACK };
