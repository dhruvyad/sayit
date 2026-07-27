import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolve, apiKey } from './config.js';
import { get } from './providers/index.js';
import { play } from './play.js';
import { acquire } from './queue.js';

/**
 * Speak `text` aloud.
 *
 * The core promise of this tool is that it always makes a sound. If a cloud
 * provider is selected but unusable, we degrade to the offline system voice
 * rather than failing silently — an agent that reports "done" to a user who
 * heard nothing is worse than a robotic voice.
 */
export async function speak(text, flags = {}) {
  const config = resolve(flags);
  const selected = get(config.provider);

  let providerId = config.provider;
  let key = apiKey(providerId, config);

  if (!selected.speaksDirectly && !key) {
    if (flags.strict) {
      throw new Error(
        `provider "${providerId}" needs a key but none was found. ` +
          `Set ${selected.envVar} or run: saynow init`,
      );
    }
    warn(
      flags,
      `no ${selected.envVar} found — using the offline system voice. Run \`saynow init\` to configure ${providerId}.`,
    );
    providerId = 'system';
    key = null;
  }

  const provider = get(providerId);

  if (provider.speaksDirectly) {
    await withQueue(flags, () =>
      provider.speak(text, {
        voice: config.voice,
        rate: config.rate,
        save: flags.save,
        signal: flags.signal,
      }),
    );
    return {};
  }

  const { audio, ext } = await provider.synthesize(text, {
    apiKey: key,
    voice: config.voice,
    model: config.model,
    speed: config.speed,
  });

  if (flags.save) {
    fs.writeFileSync(flags.save, audio);
    return { saved: path.resolve(flags.save) };
  }

  const tmp = path.join(os.tmpdir(), `saynow-${process.pid}-${Date.now()}.${ext}`);
  fs.writeFileSync(tmp, audio, { mode: 0o600 });
  try {
    await withQueue(flags, () => play(tmp, { signal: flags.signal }));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return {};
}

async function withQueue(flags, fn) {
  if (flags.noQueue) return fn();
  const release = await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function warn(flags, message) {
  if (!flags.quiet) process.stderr.write(`saynow: ${message}\n`);
}
