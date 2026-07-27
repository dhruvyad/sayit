import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_DIR = process.env.SAYNOW_CONFIG_DIR
  ? path.resolve(process.env.SAYNOW_CONFIG_DIR)
  : path.join(os.homedir(), '.config', 'saynow');

export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** Keys that hold secrets. Never printed in full. */
export const SECRET_KEYS = new Set([
  'openaiApiKey',
  'elevenlabsApiKey',
  'openrouterApiKey',
]);

export const DEFAULTS = {
  provider: 'system',
  voice: null,
  model: null,
  speed: 1,
};

export function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS };
    if (err instanceof SyntaxError) {
      throw new Error(`config at ${CONFIG_PATH} is not valid JSON: ${err.message}`);
    }
    throw err;
  }
}

export function save(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // Write via a temp file so a crash mid-write can't truncate an existing config.
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  // rename preserves the temp file's mode, but be explicit in case it pre-existed.
  fs.chmodSync(CONFIG_PATH, 0o600);
}

/**
 * Layer the config sources: defaults < config file < environment < CLI flags.
 * CLI flags arrive with undefined for anything the user didn't pass.
 */
export function resolve(flags = {}) {
  const file = load();
  const env = {};
  if (process.env.SAYNOW_PROVIDER) env.provider = process.env.SAYNOW_PROVIDER;
  if (process.env.SAYNOW_VOICE) env.voice = process.env.SAYNOW_VOICE;
  if (process.env.SAYNOW_MODEL) env.model = process.env.SAYNOW_MODEL;
  if (process.env.SAYNOW_SPEED) env.speed = Number(process.env.SAYNOW_SPEED);

  const cli = Object.fromEntries(
    Object.entries(flags).filter(([, v]) => v !== undefined),
  );

  return { ...file, ...env, ...cli };
}

/**
 * Look up a provider credential. Environment wins over the config file so a
 * shell can override without rewriting state on disk.
 */
export function apiKey(provider, config = load()) {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY || config.openaiApiKey || null;
    case 'elevenlabs':
      return process.env.ELEVENLABS_API_KEY || config.elevenlabsApiKey || null;
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY || config.openrouterApiKey || null;
    default:
      return null;
  }
}

export function redact(value) {
  if (typeof value !== 'string' || value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
