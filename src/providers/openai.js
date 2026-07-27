export const id = 'openai';
export const label = 'OpenAI /v1/audio/speech';
export const speaksDirectly = false;
export const envVar = 'OPENAI_API_KEY';
export const configKey = 'openaiApiKey';

const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'alloy';

export const knownVoices = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'fable', 'nova', 'onyx', 'sage', 'shimmer',
];

export async function synthesize(text, { apiKey, voice, model, speed } = {}) {
  const body = {
    model: model || DEFAULT_MODEL,
    voice: voice || DEFAULT_VOICE,
    input: text,
    response_format: 'mp3',
  };
  // Only the tts-1 family accepts `speed`; sending it otherwise is a 400.
  if (speed && speed !== 1) body.speed = speed;

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await describeError(res, 'OpenAI'));

  return { audio: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

export function voices() {
  return knownVoices.map((name) => ({ name, locale: 'multi', note: '' }));
}

async function describeError(res, provider) {
  let detail = '';
  try {
    const json = await res.json();
    detail = json?.error?.message || JSON.stringify(json);
  } catch {
    detail = (await res.text().catch(() => '')).slice(0, 300);
  }

  if (res.status === 401) {
    return `${provider} rejected the API key (401). Check it with: sayit config list`;
  }
  if (res.status === 429) {
    return `${provider} rate limited or out of quota (429). ${detail}`;
  }
  return `${provider} request failed (${res.status}). ${detail}`;
}
