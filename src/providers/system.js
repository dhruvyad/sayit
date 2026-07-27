import { spawn, spawnSync } from 'node:child_process';

export const id = 'system';
export const label = 'built-in OS speech synthesis (offline, no API key)';

/** The system provider speaks directly — it never produces a file to play. */
export const speaksDirectly = true;

function backend() {
  switch (process.platform) {
    case 'darwin':
      return {
        cmd: 'say',
        args: ({ voice, rate }) => [
          ...(voice ? ['-v', voice] : []),
          ...(rate ? ['-r', String(rate)] : []),
        ],
      };
    case 'linux':
      return {
        cmd: spawnSync('which', ['espeak-ng'], { stdio: 'ignore' }).status === 0
          ? 'espeak-ng'
          : 'espeak',
        args: ({ voice, rate }) => [
          ...(voice ? ['-v', voice] : []),
          ...(rate ? ['-s', String(rate)] : []),
        ],
      };
    case 'win32':
      return { cmd: 'powershell', args: () => [] };
    default:
      return null;
  }
}

export async function speak(text, { voice, rate, save, signal } = {}) {
  if (save) {
    throw new Error(
      '--save is not supported by the system provider. Configure openai or elevenlabs to write audio files.',
    );
  }

  const be = backend();
  if (!be) throw new Error(`no system speech backend known for platform "${process.platform}"`);

  // Windows needs the text embedded in the script rather than passed on argv.
  if (process.platform === 'win32') {
    const escaped = text.replace(/'/g, "''");
    const rateExpr = rate ? `$s.Rate = ${Math.max(-10, Math.min(10, rate))};` : '';
    const voiceExpr = voice ? `$s.SelectVoice('${voice.replace(/'/g, "''")}');` : '';
    return run(
      'powershell',
      [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech;` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;` +
        `${voiceExpr}${rateExpr}$s.Speak('${escaped}')`,
      ],
      signal,
    );
  }

  return run(be.cmd, [...be.args({ voice, rate }), '--', text], signal);
}

export function voices() {
  switch (process.platform) {
    case 'darwin': {
      const out = spawnSync('say', ['-v', '?'], { encoding: 'utf8' });
      if (out.status !== 0) return [];
      return out.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s*#\s*(.*)$/);
          return m ? { name: m[1].trim(), locale: m[2], note: m[3].trim() } : null;
        })
        .filter(Boolean);
    }
    case 'linux': {
      const cmd = backend().cmd;
      const out = spawnSync(cmd, ['--voices'], { encoding: 'utf8' });
      if (out.status !== 0) return [];
      return out.stdout
        .split('\n')
        .slice(1)
        .filter(Boolean)
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return parts.length >= 4 ? { name: parts[3], locale: parts[1], note: '' } : null;
        })
        .filter(Boolean);
    }
    default:
      return [];
  }
}

function run(cmd, args, signal) {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'ignore', signal });

    child.on('error', (err) => {
      // Aborting is how the stop button works, not a failure.
      if (err.name === 'AbortError') {
        resolve();
        return;
      }
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            `"${cmd}" not found. On Linux install espeak-ng (apt install espeak-ng), ` +
              `or configure a cloud provider with: saynow init`,
          ),
        );
        return;
      }
      reject(err);
    });

    child.on('close', (code, sig) =>
      code === 0 || signal?.aborted || sig
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`)),
    );
  });
}
