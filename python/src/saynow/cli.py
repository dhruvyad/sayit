"""Command-line interface for saynow."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import __version__, config as cfg, history, providers
from .audio import play, queued

SUBCOMMANDS = {"init", "config", "voices", "models", "history", "help"}


def help_text() -> str:
    """Rendered from help.txt, which is shared verbatim with the npm build."""
    raw = (Path(__file__).parent / "help.txt").read_text(encoding="utf-8")
    return (
        raw.replace("{{VERSION}}", __version__)
        .replace("{{PROVIDERS}}", ", ".join(providers.PROVIDERS))
        .replace("{{CONFIG_PATH}}", str(cfg.config_path()))
    )


class _Parser(argparse.ArgumentParser):
    """argparse cannot generate the shared help text, so override its output
    entirely and keep argparse only for parsing."""

    def format_help(self) -> str:
        return help_text()

    def format_usage(self) -> str:
        return "usage: saynow [options] <text...>\n"


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="saynow", allow_abbrev=False)
    parser.add_argument("text", nargs="*", help="text to speak (or pipe it on stdin)")
    parser.add_argument("-v", "--voice", help="voice to use (see: saynow voices)")
    parser.add_argument(
        "-p", "--provider", choices=sorted(providers.PROVIDERS), help="speech provider"
    )
    parser.add_argument("-m", "--model", help="model id (see: saynow models)")
    parser.add_argument("-r", "--rate", type=float, help="words per minute (system provider)")
    parser.add_argument("-s", "--speed", type=float, help="speed 0.25-4.0 (cloud providers)")
    parser.add_argument("--save", metavar="FILE", help="write audio to a file instead of playing")
    parser.add_argument(
        "--ask", action="store_true", help="show a reply bubble and wait (npm build only)"
    )
    parser.add_argument(
        "--no-ui", action="store_true", help="speak without showing the bubble"
    )
    parser.add_argument(
        "--no-queue", action="store_true", help="speak immediately, overlapping in-flight speech"
    )
    parser.add_argument(
        "--strict", action="store_true", help="fail instead of falling back to the system voice"
    )
    parser.add_argument("-q", "--quiet", action="store_true", help="suppress warnings on stderr")
    parser.add_argument("--version", action="version", version=__version__)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.text and args.text[0] in SUBCOMMANDS:
        command, rest = args.text[0], args.text[1:]
        if command == "help":
            parser.print_help()
            return 0
        if command == "init":
            return init_command()
        if command == "config":
            return config_command(rest)
        if command == "voices":
            return voices_command(args)
        if command == "models":
            return models_command()
        if command == "history":
            return history_command(rest)

    text = " ".join(args.text) if args.text else read_stdin()
    if not text.strip():
        parser.error("nothing to say. Pass text as an argument or pipe it on stdin.")

    return speak(text.strip(), args)


def read_stdin() -> str:
    if sys.stdin.isatty():
        return ""
    return sys.stdin.read()


def speak(text: str, args: argparse.Namespace) -> int:
    """Always make a sound: degrade to the offline voice rather than failing."""
    if args.ask and args.save:
        raise SystemExit("saynow: --ask and --save cannot be combined.")
    config = cfg.resolve(
        provider=args.provider, voice=args.voice, model=args.model, speed=args.speed
    )
    provider_id = config["provider"]
    selected = providers.get(provider_id)
    key = cfg.api_key(provider_id, config)

    if not selected["speaks_directly"] and not key:
        if args.strict:
            raise SystemExit(
                f"saynow: provider \"{provider_id}\" needs a key but none was found. "
                f"Set {selected['env_var']} or run: saynow init"
            )
        warn(
            args,
            f"no {selected['env_var']} found — using the offline system voice. "
            f"Run `saynow init` to configure {provider_id}.",
        )
        provider_id, key = "system", None

    if provider_id == "system":
        if args.save:
            raise SystemExit(
                "saynow: --save is not supported by the system provider. "
                "Configure openai or elevenlabs to write audio files."
            )
        with queued(enabled=not args.no_queue):
            providers.speak_system(text, voice=config.get("voice"), rate=args.rate)
        return 0

    audio, ext, used_model, used_voice = providers.SYNTHESIZERS[provider_id](
        text,
        api_key=key,
        voice=config.get("voice"),
        model=config.get("model"),
        speed=config.get("speed"),
    )

    # Archive before playing: a long article is expensive to regenerate.
    history.record(
        audio=audio,
        ext=ext,
        text=text,
        provider=provider_id,
        model=used_model,
        voice=used_voice,
        limit=int(config.get("historyLimit") or history.DEFAULT_LIMIT),
    )

    if args.save:
        Path(args.save).write_bytes(audio)
        if not args.quiet:
            print(os.path.abspath(args.save))
        return 0

    tmp = Path(tempfile.gettempdir()) / f"saynow-{os.getpid()}.{ext}"
    tmp.write_bytes(audio)
    os.chmod(tmp, 0o600)
    try:
        with queued(enabled=not args.no_queue):
            play(str(tmp))
    finally:
        tmp.unlink(missing_ok=True)
    return 0


def init_command() -> int:
    print("Configure saynow. Press enter to keep the current value.\n")
    for name, meta in providers.PROVIDERS.items():
        print(f"  {name:<12} {meta['label']}")
    print()

    config = cfg.load()
    chosen = input(f"Provider [{config['provider']}]: ").strip() or config["provider"]
    meta = providers.get(chosen)
    config["provider"] = chosen

    if not meta["speaks_directly"]:
        existing = config.get(meta["config_key"])
        prompt = (
            f"API key [{cfg.redact(existing)}]: "
            if existing
            else f"API key (or leave blank to use ${meta['env_var']}): "
        )
        entered = input(prompt).strip()
        if entered:
            config[meta["config_key"]] = entered

    voice = input(f"Voice [{config.get('voice') or 'default'}]: ").strip()
    if voice:
        config["voice"] = voice

    cfg.save(config)
    print(f"\nSaved to {cfg.config_path()} (mode 0600).")

    if not meta["speaks_directly"] and not cfg.api_key(chosen, config):
        print(
            f"\nNo key stored and ${meta['env_var']} is unset — "
            "saynow will use the offline system voice until one is available."
        )
    return 0


def config_command(rest: List[str]) -> int:
    action = rest[0] if rest else "list"
    config: Dict[str, Any] = cfg.load()

    if action == "path":
        print(cfg.config_path())
        return 0

    if action == "list":
        width = max(len(k) for k in config)
        for key, value in config.items():
            shown = cfg.redact(value) if key in cfg.SECRET_KEYS else value
            print(f"{key:<{width}}  {shown}")
        if not cfg.config_path().exists():
            print("\n(no config file yet — these are defaults. Run `saynow init`.)")
        return 0

    if action == "get":
        if len(rest) < 2:
            raise SystemExit("saynow: usage: saynow config get <key>")
        key = rest[1]
        if key not in config:
            raise SystemExit(f"saynow: no such key: {key}")
        print(cfg.redact(config[key]) if key in cfg.SECRET_KEYS else config[key])
        return 0

    if action == "set":
        if len(rest) < 3:
            raise SystemExit("saynow: usage: saynow config set <key> <value>")
        key, value = rest[1], " ".join(rest[2:])
        if key == "provider":
            providers.get(value)
        config[key] = float(value) if key in {"speed", "rate"} else value
        cfg.save(config)
        shown = cfg.redact(value) if key in cfg.SECRET_KEYS else config[key]
        print(f"{key} = {shown}")
        return 0

    raise SystemExit(f"saynow: unknown config command \"{action}\". Use: list, get, set, path")


def voices_command(args: argparse.Namespace) -> int:
    config = cfg.resolve(provider=args.provider, model=args.model)
    provider_id = config["provider"]
    listed = providers.voices(
        provider_id, cfg.api_key(provider_id, config), config.get("model")
    )

    if not listed:
        print(f"No voices listed for provider \"{provider_id}\".")
        return 0

    width = max(len(name) for name, _, _ in listed)
    for name, locale, note in listed:
        print(f"{name:<{width}}  {locale:<8} {note}".rstrip())
    return 0


def models_command() -> int:
    listed = providers.openrouter_audio_models()
    if not listed:
        print("Could not reach OpenRouter to list speech models.")
        return 0

    width = max(len(m["id"]) for m in listed)
    print("OpenRouter speech models:\n")
    for m in listed:
        cost = f"${m['price'] * 1000:.4f}/1k tok" if m["price"] else "free"
        voices = f"{m['voices']} voices" if m["voices"] else "voice required"
        mark = "*" if m["is_default"] else " "
        print(f"{mark} {m['id']:<{width}}  {cost:>15}  {voices}")
    print(
        '\n* default. Use another with: saynow -p openrouter -m <id> "text"'
        "\nSet a default with:          saynow config set model <id>"
        "\nList a model's voices with:  saynow voices -p openrouter -m <id>"
    )
    return 0


def history_command(rest: List[str]) -> int:
    action = rest[0] if rest else "list"

    if action == "path":
        print(history.history_dir())
        return 0

    if action == "clear":
        removed = history.clear()
        print(f"Removed {removed} clip{'' if removed == 1 else 's'}.")
        return 0

    if action == "open":
        entries = history.read_index()
        index = int(rest[1]) - 1 if len(rest) > 1 else 0
        if index < 0 or index >= len(entries):
            raise SystemExit(f"saynow: no clip at position {index + 1}. Run: saynow history")
        path = history.history_dir() / entries[index]["file"]
        subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", str(path)])
        print(path)
        return 0

    if action == "list":
        entries = history.read_index()
        if not entries:
            print("No archived clips yet.")
            print("\nThe system voice is not archived — it speaks directly and")
            print("produces no file. Cloud providers are.")
            return 0
        for i, entry in enumerate(entries, 1):
            when = entry["at"].replace("T", " ")[:16]
            size = history.format_bytes(entry["bytes"]).rjust(8)
            source = " / ".join(x for x in (entry["provider"], entry.get("model"), entry.get("voice")) if x)
            print(f"{i:>3}. {when}  {size}  {source}")
            print(f"     {' '.join(entry['text'].split())[:88]}")
        print(
            f"\n{len(entries)} clip{'' if len(entries) == 1 else 's'}, "
            f"{history.format_bytes(history.usage())} in {history.history_dir()}"
            "\nPlay one with: saynow history open <n>"
        )
        return 0

    raise SystemExit(f'saynow: unknown history command "{action}". Use: list, open, path, clear')


def warn(args: argparse.Namespace, message: str) -> None:
    if not args.quiet:
        print(f"saynow: {message}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
