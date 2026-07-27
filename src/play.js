import { spawn, spawnSync } from 'node:child_process';

/**
 * Audio players we shell out to, best first. Deliberately no native addons:
 * anything needing node-gyp breaks `npx` and breaks across Node versions.
 */
const PLAYERS = {
  darwin: [
    { cmd: 'afplay', args: (file) => [file] },
  ],
  linux: [
    { cmd: 'ffplay', args: (file) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', file] },
    { cmd: 'mpv', args: (file) => ['--no-video', '--really-quiet', file] },
    { cmd: 'mpg123', args: (file) => ['-q', file] },
    { cmd: 'paplay', args: (file) => [file] },
    { cmd: 'aplay', args: (file) => ['-q', file] },
  ],
  win32: [
    {
      cmd: 'powershell',
      args: (file) => [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName presentationCore;` +
          `$p = New-Object System.Windows.Media.MediaPlayer;` +
          `$p.Open([uri]'${file}');` +
          `Start-Sleep -Milliseconds 400;` +
          `$p.Play();` +
          `Start-Sleep -Seconds [math]::Ceiling($p.NaturalDuration.TimeSpan.TotalSeconds);`,
      ],
    },
  ],
};

const exists = (cmd) => {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [cmd], { stdio: 'ignore' }).status === 0;
};

export function findPlayer() {
  const candidates = PLAYERS[process.platform] || [];
  return candidates.find((p) => exists(p.cmd)) || null;
}

export function play(file, { signal } = {}) {
  const player = findPlayer();
  if (!player) {
    const tried = (PLAYERS[process.platform] || []).map((p) => p.cmd).join(', ');
    throw new Error(
      `no audio player found on this system (looked for: ${tried || 'none known for ' + process.platform}).\n` +
        `Install one, or use --save <file> to write the audio instead of playing it.`,
    );
  }

  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const child = spawn(player.cmd, player.args(file), { stdio: 'ignore', signal });

    child.on('error', (err) => {
      // Aborting is how the stop button works, not a failure.
      if (err.name === 'AbortError') resolve();
      else reject(err);
    });

    child.on('close', (code, sig) =>
      code === 0 || signal?.aborted || sig
        ? resolve()
        : reject(new Error(`${player.cmd} exited with code ${code}`)),
    );
  });
}
