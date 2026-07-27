<p align="center">
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/logo.png" alt="" width="88">
</p>

<h1 align="center">saynow</h1>

<p align="center"><a href="https://www.npmjs.com/package/saynow"><img alt="npm" src="https://img.shields.io/npm/v/saynow?logo=npm&logoColor=white&label=npm&color=cb3837&cacheSeconds=3600"></a>&nbsp;<a href="https://pypi.org/project/saynow/"><img alt="PyPI" src="https://img.shields.io/pypi/v/saynow?logo=pypi&logoColor=white&label=pypi&color=3775a9&cacheSeconds=3600"></a>&nbsp;<a href="https://github.com/dhruvyad/saynow/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dhruvyad/saynow/actions/workflows/ci.yml/badge.svg"></a>&nbsp;<img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-2ea44f">&nbsp;<a href="https://github.com/dhruvyad/saynow/blob/main/LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a></p>

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

## Asking, and showing

`--ask` speaks, then waits: a bubble appears in the corner with the
transcript and a reply box, and whatever is typed comes back on stdout.

```bash
answer=$(saynow --from "billing · migration" --ask "Drop the old table?")
```

Exit `0` means they answered, `2` means they dismissed it or were away —
never read `2` as consent. `--file report.md` renders a Markdown document in
the same bubble: headings, tables, code, links and images, local or remote.

The bubble needs a window shell — Xcode command line tools on macOS, or any
Chromium-based browser. Without one saynow still speaks, `--ask` exits 2, and
`--file` is read aloud rather than shown.

Both builds read the same config file, so installing the npm one alongside
this changes nothing you have already set up.

Claude Code users can install the plugin, which teaches Claude when to speak:

```
/plugin marketplace add dhruvyad/saynow
/plugin install saynow@saynow
```

## Full reference

```bash
saynow --help    # complete reference: every flag, setting, and exit code
```

## License

MIT — source at <https://github.com/dhruvyad/saynow>
