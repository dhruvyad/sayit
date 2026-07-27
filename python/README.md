# saynow

Speak text aloud from the terminal. Built so LLM agents can talk to you.

```bash
saynow "the build finished, 42 tests passed"
```

Works with no configuration — it falls back to your OS's built-in voice, which
is offline, free, and needs no API key. Add a key for better audio.

## Install

```bash
pip install saynow          # or: uv tool install saynow
```

No third-party dependencies — standard library only. An identical
[npm package](https://www.npmjs.com/package/saynow) exists for Node; both read
the same config file, so pick whichever runtime you already have.

## Usage

```bash
saynow "text to speak"              # speak an argument
echo "text" | saynow                # speak stdin
pytest 2>&1 | tail -1 | saynow      # speak a command's last line
saynow -p openai -v nova "hello"    # pick a provider and voice
saynow --save note.mp3 "hello"      # write a file instead of playing
```

| Provider | Quality | Needs |
| --- | --- | --- |
| `system` | Fair | Nothing — built into the OS |
| `openai` | Good | `OPENAI_API_KEY` |
| `elevenlabs` | Best | `ELEVENLABS_API_KEY` |
| `openrouter` | Good | `OPENROUTER_API_KEY` |

If a cloud provider is configured but its key is missing, saynow warns on
stderr and speaks with the system voice anyway. Use `--strict` to opt out.
Concurrent calls are serialized so speech never overlaps.

## Configure

```bash
saynow init                          # interactive setup
saynow config set provider openai
saynow voices                        # available voices
saynow models                        # OpenRouter models that can speak
```

Config lives at `~/.config/saynow/config.json`, mode `0600`. Precedence is
defaults → config file → environment → flags. API keys are never accepted as
flags, since argv is visible to `ps` and lands in shell history.

## Use it from an agent

Add this to your `CLAUDE.md`, `AGENTS.md`, or equivalent:

```markdown
You can speak to the user out loud with `saynow "<text>"`. Use it for things
worth interrupting for: a long task finishing, a question that blocks
progress, or an error that needs attention. Keep it to one short sentence —
it is spoken aloud, not read. Do not narrate routine progress.
```

## Full reference

```bash
saynow --help    # complete reference: every flag, setting, and exit code
```

## License

MIT — source at <https://github.com/dhruvyad/saynow>
