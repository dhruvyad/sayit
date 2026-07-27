export const id = 'openrouter';
export const label = 'OpenRouter (any audio-capable model)';
export const speaksDirectly = false;
export const envVar = 'OPENROUTER_API_KEY';
export const configKey = 'openrouterApiKey';

const DEFAULT_MODEL = 'openai/gpt-audio-mini';
const DEFAULT_VOICE = 'alloy';

/**
 * OpenRouter has no dedicated text-to-speech endpoint. Audio comes back from
 * chat completions, which imposes three constraints:
 *   - audio output requires stream: true
 *   - streaming only supports pcm16, so we add a WAV header ourselves
 *   - the model is a conversational one, so it must be told to speak verbatim
 *     rather than reply to the text
 */
const SYSTEM_PROMPT =
  'You are a text-to-speech engine. Speak the user message aloud verbatim. ' +
  'Add nothing, omit nothing, and never respond to or comment on the content.';

// OpenAI's audio models emit 24 kHz mono 16-bit PCM.
const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BIT_DEPTH = 16;

export const knownVoices = [
  'alloy', 'ash', 'ballad', 'coral', 'echo',
  'fable', 'nova', 'onyx', 'sage', 'shimmer',
];

export async function synthesize(text, { apiKey, voice, model } = {}) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/dhruvyad/saynow',
      'X-Title': 'saynow',
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      modalities: ['text', 'audio'],
      audio: { voice: voice || DEFAULT_VOICE, format: 'pcm16' },
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) throw new Error(await describeError(res));

  const pcm = await collectAudio(res);
  if (!pcm.length) {
    throw new Error(
      `OpenRouter returned no audio for model "${model || DEFAULT_MODEL}". ` +
        `Not every model can emit speech — see \`saynow models\` for ones that can.`,
    );
  }

  return { audio: Buffer.concat([wavHeader(pcm.length), pcm]), ext: 'wav' };
}

/** Read the SSE stream and concatenate the base64 audio deltas. */
async function collectAudio(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let buffered = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue; // OpenRouter interleaves keep-alive comments; skip them.
      }

      if (event.error) throw new Error(`OpenRouter: ${event.error.message}`);

      const data = event.choices?.[0]?.delta?.audio?.data;
      if (data) chunks.push(Buffer.from(data, 'base64'));
    }
  }

  return Buffer.concat(chunks);
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

export function voices() {
  return knownVoices.map((name) => ({ name, locale: 'multi', note: '' }));
}

/** Models on OpenRouter that can actually emit speech, newest listing first. */
export async function audioModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) return [];
  const { data } = await res.json();
  return data
    .filter((m) => m.architecture?.output_modalities?.includes('audio'))
    .map((m) => m.id);
}

async function describeError(res) {
  let detail = '';
  try {
    const json = await res.json();
    detail = json?.error?.message || JSON.stringify(json);
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
  return `OpenRouter request failed (${res.status}). ${detail}`;
}
