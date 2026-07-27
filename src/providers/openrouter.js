export const id = 'openrouter';
export const label = 'OpenRouter (15+ dedicated speech models)';
export const speaksDirectly = false;
export const envVar = 'OPENROUTER_API_KEY';
export const configKey = 'openrouterApiKey';

const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';

/**
 * Speech models are NOT returned by the plain /models listing — that endpoint
 * omits the whole speech category. They only appear under this filter, which
 * is an easy thing to be confidently wrong about.
 */
const SPEECH_MODELS_URL = 'https://openrouter.ai/api/v1/models?output_modalities=speech';

const DEFAULT_MODEL = 'google/gemini-3.1-flash-tts-preview';

/**
 * Voice names are vendor-specific and the API rejects a request without one,
 * so every model needs a default. These lists were verified against the live
 * API rather than taken from documentation.
 */
export const VOICES = {
  'google/gemini-3.1-flash-tts-preview': [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus',
    'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
    'Despina', 'Erinome', 'Laomedeia', 'Schedar', 'Achird', 'Sadachbia',
  ],
  'deepgram/aura-2': [
    'aura-2-thalia-en', 'aura-2-andromeda-en', 'aura-2-apollo-en',
    'aura-2-arcas-en', 'aura-2-asteria-en', 'aura-2-athena-en',
    'aura-2-helena-en', 'aura-2-orion-en', 'aura-2-zeus-en',
  ],
  'x-ai/grok-voice-tts-1.0': ['Eve'],
  'hexgrad/kokoro-82m': ['af_heart', 'af_bella', 'am_michael'],
};

// OpenAI's audio models emit 24 kHz mono 16-bit PCM, and so do the OpenRouter
// speech models that return a bare stream with no container.
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

export function defaultVoice(model) {
  return VOICES[model]?.[0] ?? null;
}

export async function synthesize(text, { apiKey, voice, model } = {}) {
  const chosenModel = model || DEFAULT_MODEL;
  const chosenVoice = voice || defaultVoice(chosenModel);

  if (!chosenVoice) {
    throw new Error(
      `model "${chosenModel}" needs an explicit voice — OpenRouter rejects a request without one, ` +
        `and saynow has no verified voice list for it.\n` +
        `Pass one with: saynow -p openrouter -m ${chosenModel} -v <voice> "text"`,
    );
  }

  const res = await fetch(SPEECH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/dhruvyad/saynow',
      'X-Title': 'saynow',
    },
    // response_format is deliberately omitted. Support varies by vendor —
    // Gemini rejects every value, Grok accepts mp3, Deepgram returns WAV
    // unasked — so we take whatever comes back and identify it below. That
    // keeps this to a single request for every model.
    body: JSON.stringify({ model: chosenModel, input: text, voice: chosenVoice }),
  });

  if (!res.ok) throw new Error(await describeError(res, chosenModel, chosenVoice));

  return {
    ...identify(Buffer.from(await res.arrayBuffer())),
    model: chosenModel,
    voice: chosenVoice,
  };
}

/** Work out what came back, wrapping bare PCM in a WAV header so it can play. */
function identify(buffer) {
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF') {
    return { audio: buffer, ext: 'wav' };
  }
  const isMp3 =
    buffer.subarray(0, 3).toString('latin1') === 'ID3' ||
    (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  if (isMp3) return { audio: buffer, ext: 'mp3' };

  return { audio: Buffer.concat([wavHeader(buffer.length), buffer]), ext: 'wav' };
}

function wavHeader(dataLength) {
  const byteRate = (SAMPLE_RATE * CHANNELS * BIT_DEPTH) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format 1 = PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((CHANNELS * BIT_DEPTH) / 8, 32);
  header.writeUInt16LE(BIT_DEPTH, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}

export function voices({ model } = {}) {
  const chosenModel = model || DEFAULT_MODEL;
  const known = VOICES[chosenModel];

  if (!known) {
    return [
      {
        name: '(unknown)',
        locale: '',
        note: `no verified voice list for ${chosenModel} — pass --voice explicitly`,
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
  const res = await fetch(SPEECH_MODELS_URL);
  if (!res.ok) return [];
  const { data } = await res.json();

  return data.map((m) => ({
    id: m.id,
    // Priced per input token; completion is free on most speech models.
    price: Number(m.pricing?.prompt ?? 0),
    voices: VOICES[m.id]?.length ?? 0,
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
