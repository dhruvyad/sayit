# saynow

Speaks text aloud from the terminal and shows a bubble carrying the transcript.
Built to be called by LLM agents that need to interrupt a human, so the failure
that matters most is a bubble that is never seen, or one that never goes away.

## Two builds, one behaviour

`bin/ src/ ui/ help.txt` are the npm build. `python/src/saynow/` is the pip
build, and it ships **copies** rather than reimplementations:

| Original | Copy |
| --- | --- |
| `ui/bubble.html` | `python/src/saynow/bubble.html` |
| `shell/SaynowPanel.swift` | `python/src/saynow/SaynowPanel.swift` |
| `help.txt` | `python/src/saynow/help.txt` |

Edit the original, then copy it across in the same change. `npm test` fails on
a drifted copy and CI diffs `--help` between the two builds. Everything else is
ported by hand — `src/markdown.js` and `markdown.py` are held to the same
fixture by both suites.

## Tests

```bash
npm test                                                   # node --test
PYTHONPATH=python/src python3 -m unittest discover -s python/tests
```

Use unittest, as CI does. `pytest` also works, but this machine's environment
loads `pytest-randomly` and `pytest-rerunfailures`, and the shuffling makes two
port-scanning auth tests fail for reasons that have nothing to do with the code.

`SAYNOW_NO_WINDOW=1` keeps a test suite from opening real panels on someone's
screen.

There is no browser in the suite: `test/helpers/dom.js` is a hand-rolled DOM
just big enough to execute `ui/bubble.html`'s script. What it stubs — layout,
focus, `scrollIntoView` — is exactly where the page's bugs have lived. When
changing the page, drive real gesture sequences through the script and assert
what a person would see, rather than trusting that it loaded.

## The bubble's one rule

**Never stop the countdown without something able to start it again.** Being
there means the pointer on the bubble or text in the reply box, and both are
read at the moment they are needed, never latched into a flag. Four separate
bugs have been the same mistake: something cancelled the dismiss timer and
nothing could undo it, so the bubble sat on screen for good and the caller
waited with it. Nothing ends a bubble on a clock, so there is no backstop to
catch the next one.

## Docs move together

A behaviour change touches `help.txt` (and its copy), `man/saynow.1`,
`README.md`, and `plugin/skills/saynow/SKILL.md`. The skill file is what other
agents read to learn how the tool behaves, so a stale line there propagates
into their instructions.

## Releasing

Bump `package.json`, `python/pyproject.toml`, `python/src/saynow/__init__.py`,
the `man/saynow.1` header and `plugin/.claude-plugin/plugin.json`, commit as
`Release <version>`, then `gh release create v<version>`. CI publishes to npm
and PyPI over OIDC — **never publish by hand**, and note that publishing the
GitHub release is the trigger, not pushing the tag.

The release workflow checks all five against the tag and refuses to publish if
any disagree. The plugin was the one that drifted, two releases behind, because
it is installed straight from this repository and no registry was ever going to
complain about it.

## Conventions

Commits take a short imperative subject and a prose body saying why, with no
prefixes or trailers, and land directly on `main`. Comments explain why rather
than what. User-facing text is British — synthesised, serialise, behaviour.
