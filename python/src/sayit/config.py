"""Configuration storage, shared on disk with the npm build of sayit."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

SECRET_KEYS = {"openaiApiKey", "elevenlabsApiKey"}

DEFAULTS: Dict[str, Any] = {
    "provider": "system",
    "voice": None,
    "model": None,
    "speed": 1,
}


def config_dir() -> Path:
    override = os.environ.get("SAYIT_CONFIG_DIR")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".config" / "sayit"


def config_path() -> Path:
    return config_dir() / "config.json"


def load() -> Dict[str, Any]:
    path = config_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return dict(DEFAULTS)
    except json.JSONDecodeError as err:
        raise SystemExit(f"sayit: config at {path} is not valid JSON: {err}")
    merged = dict(DEFAULTS)
    merged.update(data)
    return merged


def save(config: Dict[str, Any]) -> None:
    directory = config_dir()
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)

    path = config_path()
    # Write to a temp file first so a crash can't truncate an existing config.
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)
    os.chmod(path, 0o600)


def resolve(**flags: Any) -> Dict[str, Any]:
    """Layer the sources: defaults < config file < environment < CLI flags."""
    config = load()

    env_map = {
        "provider": "SAYIT_PROVIDER",
        "voice": "SAYIT_VOICE",
        "model": "SAYIT_MODEL",
        "speed": "SAYIT_SPEED",
    }
    for key, var in env_map.items():
        value = os.environ.get(var)
        if value:
            config[key] = float(value) if key == "speed" else value

    config.update({k: v for k, v in flags.items() if v is not None})
    return config


def api_key(provider: str, config: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Environment wins over the config file so a shell can override it."""
    if config is None:
        config = load()
    if provider == "openai":
        return os.environ.get("OPENAI_API_KEY") or config.get("openaiApiKey")
    if provider == "elevenlabs":
        return os.environ.get("ELEVENLABS_API_KEY") or config.get("elevenlabsApiKey")
    return None


def redact(value: Any) -> str:
    if not isinstance(value, str) or len(value) <= 8:
        return "****"
    return f"{value[:4]}…{value[-4:]}"
