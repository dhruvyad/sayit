#!/usr/bin/env node
// Build and install the macOS settings app after `npm install -g saynow`.
//
// Putting an app into /Applications during a package install is pushy, so this
// holds itself to a few rules: macOS only, never in CI, never without the
// toolchain already present, always announced, always skippable, and it can
// never fail the install it is attached to. Anyone who declines still gets the
// command line tool, and `saynow app install` any time later.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const say = (message) => process.stdout.write(`saynow: ${message}\n`);

function skip(reason) {
  // Quiet by default: a skipped optional extra is not news during an install.
  if (process.env.SAYNOW_DEBUG) say(`skipping the settings app — ${reason}`);
  process.exit(0);
}

if (process.env.SAYNOW_NO_APP) skip('SAYNOW_NO_APP is set');
if (process.platform !== 'darwin') skip('the settings app is macOS only');

// A package install inside a build agent has no use for a GUI app, and the
// four seconds of compiling is pure waste there.
if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) skip('running in CI');

const build = path.join(ROOT, 'app', 'build.sh');
if (!fs.existsSync(build)) skip('the app sources are not in this install');

if (spawnSync('which', ['swiftc'], { stdio: 'ignore' }).status !== 0) {
  say(
    'the settings app needs the Xcode command line tools. Install them with\n' +
      '        xcode-select --install\n' +
      '        then run: saynow app install',
  );
  process.exit(0);
}

// Prefer /Applications, fall back to the user's own folder when that is not
// writable — an install should not need a password.
const shared = '/Applications';
const destination = canWrite(shared)
  ? shared
  : path.join(os.homedir(), 'Applications');

const result = spawnSync('bash', [build], { cwd: ROOT, stdio: 'ignore' });
if (result.status !== 0) {
  say('could not build the settings app. Run `saynow app install` to see why.');
  process.exit(0);
}

try {
  fs.mkdirSync(destination, { recursive: true });
  const target = path.join(destination, 'Saynow.app');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'app', 'build', 'Saynow.app'), target, {
    recursive: true,
  });
  say(`installed the settings app to ${target}`);
  say('run `saynow --help` for the command line tool, or open Saynow to configure it');
} catch (error) {
  say(`could not install the settings app: ${error.message}`);
}

function canWrite(directory) {
  try {
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
