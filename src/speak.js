import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolve, apiKey } from './config.js';
import * as history from './history.js';
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
    // With the bubble up, render to a file and hand it over so the transcript
    // can follow the audio rather than a words-per-minute guess. Speaking
    // straight to the speakers stays the path when nothing is watching, since
    // it starts making sound immediately instead of after synthesis.
    if (flags.handoff && provider.synthesize) {
      const rendered = await provider.synthesize(text, {
        voice: config.voice,
        rate: flags.rate ?? config.rate,
      });
      // Deliberately not archived: the system voice is free and local, and
      // filling the archive with local notification chatter helps nobody.
      if (rendered) return rendered;
    }

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

  const {
    audio,
    ext,
    model: usedModel,
    voice: usedVoice,
    generationId,
  } = await provider.synthesize(text, {
    apiKey: key,
    voice: config.voice,
    model: config.model,
    speed: config.speed,
  });

  // Archive before playing: a long article is expensive to regenerate, and the
  // user may want to keep or share it long after the audio has finished.
  history.record({
    audio,
    ext,
    text,
    provider: providerId,
    model: usedModel ?? config.model,
    voice: usedVoice ?? config.voice,
    generationId,
    limit: config.historyLimit ?? history.DEFAULT_LIMIT,
  });

  if (flags.save) {
    fs.writeFileSync(flags.save, audio);
    return { saved: path.resolve(flags.save) };
  }

  // Hand the bytes to the caller instead of playing them here. The bubble
  // plays it in the page so the transcript can follow the audio's own clock,
  // which no estimate can match. The caller takes the playback lock for the
  // duration, so concurrent agents still take turns.
  if (flags.handoff) return { audio, ext };

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
