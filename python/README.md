# sayit

Speak text aloud from the terminal. Built so LLM agents can talk to you.

```bash
sayit "the build finished, 42 tests passed"
```

Works with no configuration at all — it falls back to your operating system's
built-in voice, which is offline, free, and needs no API key. Configure a cloud
provider when you want it to sound good.

This is the Python distribution. There is an equivalent npm package under the
same name; both read the same config file, so you can install either one.

## Install

```bash
pip install sayit
# or, to get an isolated CLI on your PATH:
uv tool install sayit
```

No third-party dependencies — it uses only the standard library.

## Usage

```bash
sayit "text to speak"             # speak an argument
echo "text" | sayit               # speak stdin
pytest 2>&1 | tail -1 | sayit     # speak the last line of a command
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
```

Config is stored at `~/.config/sayit/config.json` with `0600` permissions.
Precedence is **defaults → config file → environment → flags**.

API keys are never accepted as command-line flags — argv is visible in shell
history and to `ps`.

## Providers

| Provider | Quality | Cost | Needs |
| --- | --- | --- | --- |
| `system` | Fair | Free | Nothing — built into the OS |
| `openai` | Good | Paid | `OPENAI_API_KEY` |
| `elevenlabs` | Best | Paid | `ELEVENLABS_API_KEY` |

If a cloud provider is selected but no key is available, `sayit` warns on stderr
and speaks with the system voice anyway. Pass `--strict` to opt out.

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

## License

MIT — source at <https://github.com/dhruvyad/sayit>
