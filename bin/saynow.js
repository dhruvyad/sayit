#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { speak } from '../src/speak.js';
import { canShowBubble, showBubble } from '../src/bubble.js';
import { get, providerIds, providers } from '../src/providers/index.js';
import {
  CONFIG_PATH,
  SECRET_KEYS,
  apiKey,
  load,
  redact,
  resolve,
  save,
} from '../src/config.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const HELP = fs
  .readFileSync(path.join(ROOT, 'help.txt'), 'utf8')
  .replaceAll('{{VERSION}}', version)
  .replaceAll('{{PROVIDERS}}', providerIds.join(', '))
  .replaceAll('{{CONFIG_PATH}}', CONFIG_PATH);

const OPTIONS = {
  voice: { type: 'string', short: 'v' },
  provider: { type: 'string', short: 'p' },
  model: { type: 'string', short: 'm' },
  rate: { type: 'string', short: 'r' },
  speed: { type: 'string', short: 's' },
  save: { type: 'string' },
  ask: { type: 'boolean' },
  'no-ui': { type: 'boolean' },
  'no-queue': { type: 'boolean' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

const SUBCOMMANDS = new Set(['init', 'config', 'voices', 'models', 'help']);

async function main() {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      options: OPTIONS,
      allowPositionals: true,
      args: process.argv.slice(2),
    }));
  } catch (err) {
    fail(`${err.message}\n\nRun \`saynow --help\` for usage.`);
  }

  if (values.version) return void console.log(version);
  if (values.help || positionals[0] === 'help') return void process.stdout.write(HELP);

  const flags = {
    voice: values.voice,
    provider: values.provider,
    model: values.model,
    rate: values.rate ? Number(values.rate) : undefined,
    speed: values.speed ? Number(values.speed) : undefined,
    save: values.save,
    ask: values.ask,
    noUi: values['no-ui'],
    noQueue: values['no-queue'],
    strict: values.strict,
    quiet: values.quiet,
  };

  if (flags.provider && !providerIds.includes(flags.provider)) {
    fail(`unknown provider "${flags.provider}". Available: ${providerIds.join(', ')}`);
  }
  for (const key of ['rate', 'speed']) {
    if (flags[key] !== undefined && Number.isNaN(flags[key])) {
      fail(`--${key} must be a number`);
    }
  }

  const [command, ...rest] = positionals;

  if (SUBCOMMANDS.has(command)) {
    if (command === 'init') return initCommand();
    if (command === 'config') return configCommand(rest);
    if (command === 'voices') return voicesCommand(flags);
    if (command === 'models') return modelsCommand();
  }

  const text = positionals.length ? positionals.join(' ') : await readStdin();
  if (!text.trim()) {
    fail('nothing to say. Pass text as an argument or pipe it on stdin.\n\nRun `saynow --help` for usage.');
  }

  return speakCommand(text.trim(), flags);
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function initCommand() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Configure saynow. Press enter to keep the current value.\n');
    for (const id of providerIds) {
      const p = providers[id];
      console.log(`  ${id.padEnd(12)} ${p.label}`);
    }
    console.log();

    const config = load();
    const chosen =
      (await rl.question(`Provider [${config.provider}]: `)).trim() || config.provider;

    if (!providerIds.includes(chosen)) {
      fail(`unknown provider "${chosen}". Available: ${providerIds.join(', ')}`);
    }
    config.provider = chosen;

    const provider = get(chosen);
    if (!provider.speaksDirectly) {
      const existing = config[provider.configKey];
      const prompt = existing
        ? `API key [${redact(existing)}]: `
        : `API key (or leave blank to use $${provider.envVar}): `;
      const entered = (await rl.question(prompt)).trim();
      if (entered) config[provider.configKey] = entered;
    }

    const voice = (await rl.question(`Voice [${config.voice ?? 'default'}]: `)).trim();
    if (voice) config.voice = voice;

    save(config);
    console.log(`\nSaved to ${CONFIG_PATH} (mode 0600).`);

    if (!provider.speaksDirectly && !apiKey(chosen, config)) {
      console.log(
        `\nNo key stored and $${provider.envVar} is unset — saynow will use the offline system voice until one is available.`,
      );
    }
  } finally {
    rl.close();
  }
}

function configCommand([action, key, ...valueParts]) {
  const config = load();

  switch (action) {
    case 'path':
      return void console.log(CONFIG_PATH);

    case 'list':
    case undefined: {
      const rows = Object.entries(config).map(([k, v]) => [
        k,
        SECRET_KEYS.has(k) ? redact(v) : String(v),
      ]);
      const width = Math.max(...rows.map(([k]) => k.length));
      for (const [k, v] of rows) console.log(`${k.padEnd(width)}  ${v}`);
      if (!fs.existsSync(CONFIG_PATH)) {
        console.log(`\n(no config file yet — these are defaults. Run \`saynow init\`.)`);
      }
      return;
    }

    case 'get': {
      if (!key) fail('usage: saynow config get <key>');
      const value = config[key];
      if (value === undefined) fail(`no such key: ${key}`);
      return void console.log(SECRET_KEYS.has(key) ? redact(value) : value);
    }

    case 'set': {
      const value = valueParts.join(' ');
      if (!key || !value) fail('usage: saynow config set <key> <value>');
      if (key === 'provider' && !providerIds.includes(value)) {
        fail(`unknown provider "${value}". Available: ${providerIds.join(', ')}`);
      }
      config[key] = key === 'speed' || key === 'rate' ? Number(value) : value;
      save(config);
      return void console.log(
        `${key} = ${SECRET_KEYS.has(key) ? redact(value) : config[key]}`,
      );
    }

    default:
      fail(`unknown config command "${action}". Use: list, get, set, path`);
  }
}

async function voicesCommand(flags) {
  const config = resolve(flags);
  const provider = get(config.provider);
  const list = await provider.voices({ apiKey: apiKey(config.provider, config) });

  if (!list.length) {
    console.log(`No voices listed for provider "${config.provider}".`);
    return;
  }

  const width = Math.max(...list.map((v) => v.name.length));
  for (const v of list) {
    console.log(`${v.name.padEnd(width)}  ${v.locale.padEnd(8)} ${v.note}`.trimEnd());
  }
}

/**
 * Speak the text, showing the bubble alongside unless asked not to.
 *
 * With --ask the bubble carries a reply box and we block on it, printing the
 * answer to stdout. Without it the bubble is a transcript that fades out once
 * the audio stops, so a missed sentence is still readable.
 */
async function speakCommand(text, flags) {
  if (flags.ask && flags.save) fail('--ask and --save cannot be combined.');

  // --save writes a file and plays nothing, so there is nothing to narrate.
  const wantsUi = !flags.noUi && !flags.save;
  const shell = wantsUi ? canShowBubble() : null;

  if (!shell) {
    if (wantsUi && flags.ask && !flags.quiet) {
      process.stderr.write(
        'saynow: no window shell available, so --ask can only speak. ' +
          'Install a Chromium-based browser, or Xcode command line tools on macOS.\n',
      );
    }
    const result = await speak(text, flags);
    if (result?.saved && !flags.quiet) console.log(result.saved);
    if (flags.ask) process.exitCode = 2;
    return;
  }

  const stop = new AbortController();
  const speech = speak(text, { ...flags, signal: stop.signal }).catch((err) => {
    process.stderr.write(`saynow: ${err.message}\n`);
  });

  const answer = await showBubble({
    text,
    ask: Boolean(flags.ask),
    rate: flags.rate,
    speech,
    onStop: () => stop.abort(),
  });

  stop.abort();
  await speech;

  if (!flags.ask) return;

  if (answer.reason === 'reply' && answer.text) {
    console.log(answer.text);
    return;
  }
  process.exitCode = 2;
}

async function modelsCommand() {
  const { audioModels } = providers.openrouter;
  const list = await audioModels();

  if (!list.length) {
    console.log('Could not reach OpenRouter to list models.');
    return;
  }

  console.log('OpenRouter models that can emit speech:\n');
  for (const model of list) console.log(`  ${model}`);
  console.log(
    `\nUse one with: saynow -p openrouter -m <id> "text"` +
      `\nOr set a default: saynow config set model <id>`,
  );
}

function fail(message) {
  process.stderr.write(`saynow: ${message}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`saynow: ${err.message}\n`);
  process.exit(1);
});
