export const id = 'elevenlabs';
export const label = 'ElevenLabs text-to-speech';
export const speaksDirectly = false;
export const envVar = 'ELEVENLABS_API_KEY';
export const configKey = 'elevenlabsApiKey';

const DEFAULT_MODEL = 'eleven_turbo_v2_5';
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // "Rachel", ElevenLabs' default public voice

export async function synthesize(text, { apiKey, voice, model, speed } = {}) {
  const voiceId = voice || DEFAULT_VOICE;
  const body = {
    text,
    model_id: model || DEFAULT_MODEL,
  };
  if (speed && speed !== 1) body.voice_settings = { speed };

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    let detail = '';
    try {
      const json = await res.json();
      detail = json?.detail?.message || json?.detail?.status || JSON.stringify(json);
    } catch {
      detail = (await res.text().catch(() => '')).slice(0, 300);
    }
    if (res.status === 401) {
      return Promise.reject(
        new Error('ElevenLabs rejected the API key (401). Check it with: saynow config list'),
      );
    }
    throw new Error(`ElevenLabs request failed (${res.status}). ${detail}`);
  }

  return { audio: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
}

export async function voices({ apiKey } = {}) {
  if (!apiKey) return [];
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': apiKey },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.voices || []).map((v) => ({
    name: `${v.name}  (${v.voice_id})`,
    locale: v.labels?.accent || 'multi',
    note: v.labels?.description || '',
  }));
}
