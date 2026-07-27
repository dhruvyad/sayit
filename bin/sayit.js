#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { speak } from '../src/speak.js';
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

const HELP = `sayit ${version} — speak text aloud from the terminal

USAGE
  sayit <text...>              Speak the given text
  echo "text" | sayit          Speak text from stdin
  sayit init                   Configure a provider and API key
  sayit config <cmd>           Inspect or edit configuration
  sayit voices                 List voices for the active provider

OPTIONS
  -v, --voice <name>     Voice to use (see: sayit voices)
  -p, --provider <id>    ${providerIds.join(' | ')}
  -r, --rate <n>         Words per minute (system provider only)
  -s, --speed <n>        Playback speed 0.25-4.0 (cloud providers only)
      --save <file>      Write audio to a file instead of playing it
      --no-queue         Speak immediately, overlapping any in-flight speech
      --strict           Fail instead of falling back to the system voice
  -q, --quiet            Suppress warnings on stderr
  -h, --help             Show this help
      --version          Show version

CONFIG
  sayit config list            Show current settings (keys redacted)
  sayit config get <key>
  sayit config set <key> <val>
  sayit config path            Print the config file location

  Config lives at ${CONFIG_PATH} with 0600 permissions.
  Precedence: defaults < config file < environment < flags.
  Keys: provider, voice, model, speed, openaiApiKey, elevenlabsApiKey
  Env:  SAYIT_PROVIDER, SAYIT_VOICE, SAYIT_MODEL, SAYIT_SPEED,
        OPENAI_API_KEY, ELEVENLABS_API_KEY

NOTES
  With no provider configured, sayit uses the built-in OS voice — offline,
  no API key, works out of the box. Configure a cloud provider for better
  audio quality.

  Concurrent invocations are queued so speech never overlaps.

EXAMPLES
  sayit "the build finished"
  sayit -p openai -v nova "tests passed, 42 of 42"
  sayit --save note.mp3 "long form text"
  npm test 2>&1 | tail -1 | sayit
`;

const OPTIONS = {
  voice: { type: 'string', short: 'v' },
  provider: { type: 'string', short: 'p' },
  rate: { type: 'string', short: 'r' },
  speed: { type: 'string', short: 's' },
  save: { type: 'string' },
  'no-queue': { type: 'boolean' },
  strict: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

const SUBCOMMANDS = new Set(['init', 'config', 'voices', 'help']);

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
    fail(`${err.message}\n\nRun \`sayit --help\` for usage.`);
  }

  if (values.version) return void console.log(version);
  if (values.help || positionals[0] === 'help') return void console.log(HELP);

  const flags = {
    voice: values.voice,
    provider: values.provider,
    rate: values.rate ? Number(values.rate) : undefined,
    speed: values.speed ? Number(values.speed) : undefined,
    save: values.save,
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
  }

  const text = positionals.length ? positionals.join(' ') : await readStdin();
  if (!text.trim()) {
    fail('nothing to say. Pass text as an argument or pipe it on stdin.\n\nRun `sayit --help` for usage.');
  }

  const result = await speak(text.trim(), flags);
  if (result?.saved && !flags.quiet) console.log(result.saved);
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
    console.log('Configure sayit. Press enter to keep the current value.\n');
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
        `\nNo key stored and $${provider.envVar} is unset — sayit will use the offline system voice until one is available.`,
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
        console.log(`\n(no config file yet — these are defaults. Run \`sayit init\`.)`);
      }
      return;
    }

    case 'get': {
      if (!key) fail('usage: sayit config get <key>');
      const value = config[key];
      if (value === undefined) fail(`no such key: ${key}`);
      return void console.log(SECRET_KEYS.has(key) ? redact(value) : value);
    }

    case 'set': {
      const value = valueParts.join(' ');
      if (!key || !value) fail('usage: sayit config set <key> <value>');
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

function fail(message) {
  process.stderr.write(`sayit: ${message}\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`sayit: ${err.message}\n`);
  process.exit(1);
});
