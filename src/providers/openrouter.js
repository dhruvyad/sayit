import { catalog, cachedVoices, defaultVoice as catalogDefaultVoice, voicesFor } from '../catalog.js';

export const id = 'openrouter';
export const label = 'OpenRouter (15+ dedicated speech models)';
export const speaksDirectly = false;
export const envVar = 'OPENROUTER_API_KEY';
export const configKey = 'openrouterApiKey';

const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

const DEFAULT_MODEL = 'google/gemini-3.1-flash-tts-preview';

/**
 * Vendors that reject the provider default and insist on mp3. Taken from their
 * own 400 messages rather than guessed; anything not listed is retried
 * automatically when the error names response_format.
 */
const NEEDS_MP3 = new Set(['minimax/speech-2.8-turbo', 'minimax/speech-2.8-hd']);

// OpenAI's audio models emit 24 kHz mono 16-bit PCM, and so do the OpenRouter
// speech models that return a bare stream with no container.
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

export function defaultVoice(model) {
  return catalogDefaultVoice(model);
}

export async function synthesize(text, { apiKey, voice, model } = {}) {
  const chosenModel = model || DEFAULT_MODEL;
  const chosenVoice = voice || defaultVoice(chosenModel);

  if (!chosenVoice) {
    throw new Error(
      `model "${chosenModel}" needs a voice and OpenRouter publishes none for it.\n` +
        `See what it accepts with: saynow voices -p openrouter -m ${chosenModel}\n` +
        `Then: saynow -p openrouter -m ${chosenModel} -v <voice> "text"`,
    );
  }

  // Format support varies sharply: Gemini rejects every value, Deepgram
  // returns WAV unasked, MiniMax and Mistral refuse anything but mp3. So we
  // send nothing unless the model is known to demand mp3, and retry once if
  // the rejection names response_format.
  let res = await request(apiKey, chosenModel, text, chosenVoice,
    NEEDS_MP3.has(chosenModel) ? 'mp3' : undefined);

  if (!res.ok && res.status === 400) {
    const detail = await res.clone().text().catch(() => '');
    if (/response_format/i.test(detail)) {
      res = await request(apiKey, chosenModel, text, chosenVoice, 'mp3');
    }
  }

  if (!res.ok) throw new Error(await describeError(res, chosenModel, chosenVoice));

  return {
    ...identify(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type')),
    model: chosenModel,
    voice: chosenVoice,
    // Lets the caller look up what this actually cost, without delaying speech.
    generationId: res.headers.get('x-generation-id') ?? null,
  };
}

function request(apiKey, model, input, voice, responseFormat) {
  const body = { model, input, voice };
  if (responseFormat) body.response_format = responseFormat;

  return fetch(SPEECH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/dhruvyad/saynow',
      'X-Title': 'saynow',
    },
    body: JSON.stringify(body),
  });
}

/** What one synthesis actually cost, in USD. Null if it cannot be determined. */
export async function lookupCost(generationId, apiKey) {
  if (!generationId || !apiKey) return null;
  try {
    const res = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(generationId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!res.ok) return null;
    const { data } = await res.json();
    const cost = Number(data?.total_cost);
    return Number.isFinite(cost) ? cost : null;
  } catch {
    return null;
  }
}

/**
 * Work out what came back, wrapping bare PCM in a WAV header so it can play.
 * The Content-Type is authoritative and carries the sample rate — guessing
 * 24 kHz for a stream that is not 24 kHz plays it at the wrong pitch.
 */
function identify(buffer, contentType) {
  const type = (contentType || '').toLowerCase();

  if (type.includes('mpeg') || type.includes('mp3')) return { audio: buffer, ext: 'mp3' };
  if (type.includes('wav')) return { audio: buffer, ext: 'wav' };

  if (type.includes('pcm')) {
    const rate = Number(/rate=(\d+)/.exec(type)?.[1]) || SAMPLE_RATE;
    const channels = Number(/channels=(\d+)/.exec(type)?.[1]) || CHANNELS;
    return { audio: Buffer.concat([wavHeader(buffer.length, rate, channels), buffer]), ext: 'wav' };
  }

  // No usable Content-Type: fall back to the magic bytes.
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF') return { audio: buffer, ext: 'wav' };
  const isMp3 =
    buffer.subarray(0, 3).toString('latin1') === 'ID3' ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (isMp3) return { audio: buffer, ext: 'mp3' };

  return { audio: Buffer.concat([wavHeader(buffer.length), buffer]), ext: 'wav' };
}

function wavHeader(dataLength, rate = SAMPLE_RATE, channels = CHANNELS) {
  const byteRate = (rate * channels * BIT_DEPTH) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format 1 = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * BIT_DEPTH) / 8, 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

export async function voices({ model } = {}) {
  const chosenModel = model || DEFAULT_MODEL;
  const known = await voicesFor(chosenModel);

  if (!known.length) {
    return [
      {
        name: '(none published)',
        locale: '',
        note: `OpenRouter lists no voices for ${chosenModel} — pass --voice to try one`,
      },
    ];
  }

  return known.map((name, i) => ({
    name,
    locale: chosenModel.split('/')[0],
    note: i === 0 ? 'default' : '',
  }));
}

/** Every OpenRouter model that can synthesise speech, with what it costs. */
export async function audioModels() {
  const models = await catalog({ refresh: true });
  return models.map((m) => ({
    id: m.id,
    // Priced per input token; completion is free on most speech models.
    price: m.price,
    voices: m.voices.length || cachedVoices(m.id).length,
    isDefault: m.id === DEFAULT_MODEL,
  }));
}

async function describeError(res, model, voice) {
  let detail = '';
  try {
    const json = await res.json();
    detail = json?.error?.message || json?.error?.name || JSON.stringify(json);
  } catch {
    detail = (await res.text().catch(() => '')).slice(0, 300);
  }

  if (res.status === 401) {
    return 'OpenRouter rejected the API key (401). Check it with: saynow config list';
  }
  if (res.status === 402) {
    return `OpenRouter is out of credit (402). ${detail}`;
  }
  if (res.status === 429) {
    return `OpenRouter rate limited (429). ${detail}`;
  }
  if (res.status === 400) {
    return (
      `OpenRouter rejected the request for ${model} with voice "${voice}" (400). ` +
      `Voice names are vendor-specific — run: saynow voices -p openrouter -m ${model}\n${detail}`
    );
  }
  return `OpenRouter request failed (${res.status}). ${detail}`;
}

export { DEFAULT_MODEL };
