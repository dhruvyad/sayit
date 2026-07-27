#!/usr/bin/env node
// Build and install the macOS settings app after `npm install -g saynow`.
//
// The hard rule here is that this must never be able to hold up an install.
// Compiling touches swiftc, iconutil and codesign, any of which can be slow or
// stall on a machine we know nothing about — an unaccepted Xcode licence, a
// locked keychain, a cold toolchain. So the work is detached and npm is not
// made to wait for it: the install finishes immediately and the app appears a
// few seconds later, or it does not and the CLI is unaffected either way.
//
// It also holds itself to: macOS only, never in CI, never without the
// toolchain already present, and skippable with SAYNOW_NO_APP.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function skip(reason) {
  if (process.env.SAYNOW_DEBUG) process.stdout.write(`saynow: skipping the app — ${reason}\n`);
  process.exit(0);
}

if (process.env.SAYNOW_NO_APP) skip('SAYNOW_NO_APP is set');
if (process.platform !== 'darwin') skip('the settings app is macOS only');
if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) skip('running in CI');

const helper = path.join(ROOT, 'scripts', 'install-app.sh');
if (!fs.existsSync(helper)) skip('the app sources are not in this install');

// Checked here rather than in the helper so the common "no Xcode tools" case
// costs nothing and stays silent.
if (spawnSync('which', ['swiftc'], { stdio: 'ignore' }).status !== 0) {
  skip('the Xcode command line tools are not installed');
}

// Detached, with every stream closed. Nothing it does can prompt, print into
// the install log, or keep npm waiting.
const child = spawn('bash', [helper], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
});
child.unref();

process.exit(0);
