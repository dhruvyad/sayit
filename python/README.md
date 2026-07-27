# saynow

Speak text aloud from the terminal. Built so LLM agents can talk to you.

```bash
saynow "the build finished, 42 tests passed"
```

Works with no configuration at all — it falls back to your operating system's
built-in voice, which is offline, free, and needs no API key. Configure a cloud
provider when you want it to sound good.

## Status: not published to PyPI

The shipping build of saynow is [the npm package](https://www.npmjs.com/package/saynow).
This Python port is a complete, working equivalent that lives in the repo but is
deliberately unpublished — maintaining two implementations in lockstep is a cost
worth paying only once someone actually needs the Python one.

The name is available on PyPI, so it can be published at any time. Open an issue
if you want it.

## Install from source

```bash
git clone https://github.com/dhruvyad/saynow
uv tool install ./saynow/python
```

No third-party dependencies — it uses only the standard library. Both builds
read the same config file, so they are interchangeable on one machine.

## Usage

```bash
saynow "text to speak"             # speak an argument
echo "text" | saynow               # speak stdin
pytest 2>&1 | tail -1 | saynow     # speak the last line of a command
```

| Flag | Meaning |
| --- | --- |
| `-v, --voice <name>` | Voice to use — see `saynow voices` |
| `-p, --provider <id>` | `system`, `openai`, or `elevenlabs` |
| `-r, --rate <n>` | Words per minute (system provider) |
| `-s, --speed <n>` | Playback speed 0.25–4.0 (cloud providers) |
| `--save <file>` | Write audio to a file instead of playing it |
| `--no-queue` | Speak immediately, overlapping in-flight speech |
| `--strict` | Fail rather than falling back to the system voice |
| `-q, --quiet` | Suppress warnings on stderr |

## Configuration

```bash
saynow init          # interactive setup
saynow config list   # show settings, API keys redacted
saynow config set provider openai
```

Config is stored at `~/.config/saynow/config.json` with `0600` permissions.
Precedence is **defaults → config file → environment → flags**.

API keys are never accepted as command-line flags — argv is visible in shell
history and to `ps`.

## Providers

| Provider | Quality | Cost | Needs |
| --- | --- | --- | --- |
| `system` | Fair | Free | Nothing — built into the OS |
| `openai` | Good | Paid | `OPENAI_API_KEY` |
| `elevenlabs` | Best | Paid | `ELEVENLABS_API_KEY` |

If a cloud provider is selected but no key is available, `saynow` warns on stderr
and speaks with the system voice anyway. Pass `--strict` to opt out.

## Using it from an agent

Add this to your `CLAUDE.md`, `AGENTS.md`, or equivalent:

```markdown
You can speak to the user out loud with `saynow "<text>"`. Use it for things
worth interrupting for: a long task finishing, a question that blocks progress,
or an error that needs attention. Keep it to one short sentence — it is spoken
aloud, not read. Do not narrate routine progress.
```

Concurrent invocations are serialized with a lock file, so three calls in a row
produce three sentences rather than one muddle.

## License

MIT — source at <https://github.com/dhruvyad/saynow>
