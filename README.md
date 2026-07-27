<h1 align="center">saynow</h1>

<p align="center">
  Speak text aloud from the terminal. Built so LLM agents can talk to you — and so you can talk back.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/saynow"><img alt="npm" src="https://img.shields.io/npm/v/saynow?logo=npm&logoColor=white&label=npm&color=cb3837"></a>
  <a href="https://pypi.org/project/saynow/"><img alt="PyPI" src="https://img.shields.io/pypi/v/saynow?logo=pypi&logoColor=white&label=pypi&color=3775a9"></a>
  <a href="https://github.com/dhruvyad/saynow/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dhruvyad/saynow/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="dependencies" src="https://img.shields.io/badge/dependencies-0-2ea44f">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/bubble-ask.png" alt="saynow bubble showing a spoken transcript with a reply box" width="720">
</p>

```bash
saynow "the build finished, 42 tests passed"
```

It speaks, and shows a bubble in the corner with the transcript lit word by word —
so a sentence you half-heard is still readable. Works with no configuration at
all, falling back to your OS's built-in voice: offline, free, no API key.

## Install

```bash
npm install -g saynow     # Node >= 18
pip install saynow        # Python >= 3.9
```

Same CLI, same config file, zero dependencies either way — pick whichever
runtime you already have. Or skip installing: `npx saynow "hello"`.

## Ask a question and wait for the answer

```bash
answer=$(saynow --ask "Should I drop the old table?")
```

Speaks, shows a reply box, and blocks. The reply goes to stdout; exit `0` means
they answered, exit `2` means nobody was there. That distinction is the point —
an agent can tell "they said no" apart from "they were away from the desk".

<p align="center">
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/bubble-speak.png" alt="saynow bubble while speaking, without a reply box" width="720">
</p>

## Usage

```bash
saynow "text to speak"              # speak an argument
echo "text" | saynow                # speak stdin
npm test 2>&1 | tail -1 | saynow    # speak a command's last line
saynow -p openai -v nova "hello"    # pick a provider and voice
saynow --no-ui "hello"              # speak without the bubble
saynow --save note.mp3 "hello"      # write a file instead of playing
```

| Provider | Quality | Needs |
| --- | --- | --- |
| `system` | Fair | Nothing — built into the OS |
| `openai` | Good | `OPENAI_API_KEY` |
| `elevenlabs` | Best | `ELEVENLABS_API_KEY` |
| `openrouter` | **Best** | `OPENROUTER_API_KEY` — 15+ speech models behind one key |

If a cloud provider is configured but its key is missing, saynow warns on stderr
and speaks with the system voice anyway — an agent reporting "done" to someone
who heard nothing is worse than a robotic voice. Use `--strict` to opt out.
Concurrent calls are serialized machine-wide, so three agents speaking at once
produce three sentences rather than one muddle.

## Configure

```bash
saynow init                                    # interactive setup
saynow config set provider openrouter
saynow models                                  # speech models, with prices
saynow voices -p openrouter -m deepgram/aura-2 # that model's voices
```

`saynow models` lists every OpenRouter speech model — Google, xAI, Deepgram,
MiniMax, Qwen, Kokoro and others — with the price of each, loaded live.

## Keep what you synthesised

Reading a long article costs money and seconds, so every cloud synthesis is
archived rather than thrown away:

```bash
saynow history            # newest first, with size and model
saynow history open 3     # play one back
saynow history path       # the directory, to share a file from it
```

The newest 50 are kept — `saynow config set historyLimit <n>` to change it, or
`0` to archive nothing.

Config lives at `~/.config/saynow/config.json`, mode `0600`. Precedence is
defaults → config file → environment → flags. API keys are never accepted as
flags, since argv is visible to `ps` and lands in shell history.

## Use it from an agent

Add this to your `CLAUDE.md`, `AGENTS.md`, or equivalent:

```markdown
You can speak to the user out loud with `saynow "<text>"`, and ask a blocking
question with `saynow --ask "<text>"`, which prints their reply to stdout. Use
it for things worth interrupting for: a long task finishing, a question that
blocks progress, or an error that needs attention. Keep it to one short
sentence — it is spoken aloud, not read. Do not narrate routine progress.
```

## How the bubble works

On macOS it's a borderless `NSPanel` hosting a `WKWebView`: no Dock icon, no
entry in the app switcher, and it never steals focus from what you're doing. It
compiles from [`shell/SaynowPanel.swift`](shell/SaynowPanel.swift) on first use
and caches the binary — **about 84 KB**, because it borrows the system's WebKit
instead of shipping a browser. Elsewhere it falls back to a Chromium app window
loading the identical page, and with neither available saynow just speaks.

All of the UI is one file, [`ui/bubble.html`](ui/bubble.html).

## Full reference

```bash
saynow --help    # every flag, setting, and exit code
man saynow       # the same, as a man page
```

Both render from a single [`help.txt`](help.txt) shared by the npm and pip
builds, and CI fails if they ever disagree.

## License

MIT
