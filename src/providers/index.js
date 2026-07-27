import * as system from './system.js';
import * as openai from './openai.js';
import * as elevenlabs from './elevenlabs.js';

export const providers = { system, openai, elevenlabs };

export const providerIds = Object.keys(providers);

export function get(id) {
  const provider = providers[id];
  if (!provider) {
    throw new Error(
      `unknown provider "${id}". Available: ${providerIds.join(', ')}`,
    );
  }
  return provider;
}
