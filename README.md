# sayit

Speak text aloud from the terminal. Built so LLM agents can talk to you.

```bash
sayit "the build finished, 42 tests passed"
```

Works with no configuration at all — it falls back to your operating system's
built-in voice, which is offline, free, and needs no API key. Configure a cloud
provider when you want it to sound good.

## Install

```bash
npm install -g sayit
```

Or run it without installing:

```bash
npx sayit "hello"
```

A global install is meaningfully faster for repeated calls, since `npx` does a
registry lookup each run.

## Usage

```bash
sayit "text to speak"           # speak an argument
echo "text" | sayit             # speak stdin
npm test 2>&1 | tail -1 | sayit # speak the last line of a command
```

| Flag | Meaning |
| --- | --- |
| `-v, --voice <name>` | Voice to use — see `sayit voices` |
| `-p, --provider <id>` | `system`, `openai`, or `elevenlabs` |
| `-r, --rate <n>` | Words per minute (system provider) |
| `-s, --speed <n>` | Playback speed 0.25–4.0 (cloud providers) |
| `--save <file>` | Write audio to a file instead of playing it |
| `--no-queue` | Speak immediately, overlapping in-flight speech |
| `--strict` | Fail rather than falling back to the system voice |
| `-q, --quiet` | Suppress warnings on stderr |

## Configuration

```bash
sayit init          # interactive setup
sayit config list   # show settings, API keys redacted
sayit config set provider openai
sayit config path
```

Config is stored at `~/.config/sayit/config.json` with `0600` permissions.
Precedence is **defaults → config file → environment → flags**.

Keys are read from the environment first, so you can override without touching
disk:

```bash
export OPENAI_API_KEY=sk-...
sayit -p openai "using the env key"
```

API keys are never accepted as command-line flags — argv is visible in shell
history and to `ps`.

## Providers

| Provider | Quality | Cost | Needs |
| --- | --- | --- | --- |
| `system` | Fair | Free | Nothing — built into the OS |
| `openai` | Good | Paid | `OPENAI_API_KEY` |
| `elevenlabs` | Best | Paid | `ELEVENLABS_API_KEY` |

If a cloud provider is selected but no key is available, `sayit` warns on stderr
and speaks with the system voice anyway. An agent that reports "done" to someone
who heard nothing is worse than a robotic voice. Pass `--strict` to opt out of
that behavior.

## Using it from an agent

Add this to your `CLAUDE.md`, `AGENTS.md`, or equivalent:

```markdown
You can speak to the user out loud with `sayit "<text>"`. Use it for things
worth interrupting for: a long task finishing, a question that blocks progress,
or an error that needs attention. Keep it to one short sentence — it is spoken
aloud, not read. Do not narrate routine progress.
```

Concurrent invocations are serialized with a lock file, so three calls in a row
produce three sentences rather than one muddle.

## Platform notes

Playback shells out to whatever the system already has — `afplay` on macOS,
`ffplay`/`mpv`/`mpg123`/`paplay`/`aplay` on Linux, PowerShell on Windows. There
are no native addons, so installs never invoke `node-gyp`.

The system voice uses `say` on macOS, `espeak-ng` on Linux (`apt install
espeak-ng`), and `System.Speech` on Windows. macOS and Windows work out of the
box. Windows support is best-effort in this release and less tested than the
others.

## License

MIT
