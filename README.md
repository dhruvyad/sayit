<p align="center">
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/logo.png" alt="" width="104">
</p>

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
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/bubble-ask.png" alt="saynow speaking, with a transcript and a reply box" width="680">
</p>

```bash
saynow "the build finished, 42 tests passed"
```

It speaks, and shows a bubble in the corner with the transcript lit word by
word — so a sentence you half-heard is still readable. Works with no
configuration, falling back to your OS's built-in voice: offline, free, no key.

## Install

```bash
npm install -g saynow     # Node >= 18
pip install saynow        # Python >= 3.9
```

Same CLI, same config file, zero dependencies either way. On macOS this also
installs the [settings app](#settings-app); set `SAYNOW_NO_APP=1` to skip it.
To try it without installing: `npx saynow "hello"`.

## Ask, and wait for the answer

```bash
answer=$(saynow --ask "Should I drop the old table?")
```

Speaks, shows a reply box, and blocks. The reply goes to stdout. Exit `0` means
they answered, exit `2` means nobody was there — so an agent can tell "they said
no" from "they were away from the desk".

## Usage

```bash
saynow "text to speak"              # speak an argument
echo "text" | saynow                # speak stdin
npm test 2>&1 | tail -1 | saynow    # speak a command's last line
saynow -p openrouter -v Kore "hi"   # pick a provider and voice
saynow --no-ui "hello"              # speak without the bubble
saynow --save note.mp3 "hello"      # write a file instead of playing
```

| Provider | Quality | Needs |
| --- | --- | --- |
| `system` | Fair | Nothing — built into the OS |
| `openai` | Good | `OPENAI_API_KEY` |
| `elevenlabs` | Best | `ELEVENLABS_API_KEY` |
| `openrouter` | **Best** | `OPENROUTER_API_KEY` — 15 speech models, 245 voices |

If a provider is configured but its key is missing, saynow warns on stderr and
speaks with the system voice anyway: an agent reporting "done" to someone who
heard nothing is worse than a robotic voice. `--strict` opts out. Concurrent
calls are serialized machine-wide, so three agents produce three sentences
rather than one muddle.

## Keep what you synthesised

Reading a long article costs money and seconds, so every cloud synthesis is
archived with its duration and what it cost:

```bash
saynow history            # newest first
saynow history open 3     # play one back
saynow history path       # to share a file from it
```

The newest 50 are kept — `saynow config set historyLimit <n>`, or `0` for none.

## Settings app

<p align="center">
  <img src="https://raw.githubusercontent.com/dhruvyad/saynow/main/docs/app.png" alt="the saynow settings app" width="620">
</p>

macOS only, installed alongside the CLI. Picks a model from the live catalogue
with prices, stores keys, and browses, plays and prices the archive. It compiles
from source during install, so it needs the Xcode command line tools
(`xcode-select --install`); without them the install skips it and says so, and
`saynow app install` adds it later.

It is a separate process from the CLI — they meet only at
`~/.config/saynow/config.json`, so either works without the other.

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

On macOS it is a borderless `NSPanel` hosting a `WKWebView`: no Dock icon, no
entry in the app switcher, and it never steals focus. It compiles from
[`shell/SaynowPanel.swift`](shell/SaynowPanel.swift) on first use and caches the
binary — **about 84 KB**, because it borrows the system WebKit instead of
shipping a browser. Elsewhere it falls back to a Chromium app window loading the
identical page, and with neither available saynow just speaks.

All of the bubble is one file, [`ui/bubble.html`](ui/bubble.html).

## Reference

```bash
saynow --help    # every flag, setting and exit code
man saynow       # the same, as a man page
```

Both render from a single [`help.txt`](help.txt) shared by the npm and pip
builds, and CI fails if they ever disagree.

## License

MIT
