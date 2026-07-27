"""Archive of synthesised audio, shared on disk with the npm build.

Reading a long article costs real money and real seconds, so every cloud
synthesis is kept here and pruned by count.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_LIMIT = 50


def history_dir() -> Path:
    override = os.environ.get("SAYNOW_HISTORY_DIR")
    if override:
        return Path(override).expanduser()
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "saynow" / "history"
    base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / "saynow" / "history"


def index_path() -> Path:
    return history_dir() / "index.json"


def read_index() -> List[Dict[str, Any]]:
    try:
        parsed = json.loads(index_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _write_index(entries: List[Dict[str, Any]]) -> None:
    path = index_path()
    path.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def record(
    audio: bytes,
    ext: str,
    text: str,
    provider: str,
    model: Optional[str] = None,
    voice: Optional[str] = None,
    generation_id: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
) -> Optional[Dict[str, Any]]:
    """Archive one synthesis. Never raises: losing the archive must not stop
    saynow from speaking."""
    if not limit or limit < 1 or not audio:
        return None

    try:
        directory = history_dir()
        directory.mkdir(parents=True, exist_ok=True)
        os.chmod(directory, 0o700)

        at = datetime.now(timezone.utc)
        stamp = at.isoformat().replace(":", "-").replace(".", "-")[:19]
        digest = hashlib.sha256(audio).hexdigest()[:8]
        name = f"{stamp}-{digest}.{ext}"

        target = directory / name
        target.write_bytes(audio)
        os.chmod(target, 0o600)

        entry = {
            "file": name,
            "at": at.isoformat(),
            "bytes": len(audio),
            "provider": provider,
            "model": model,
            "voice": voice,
            # Resolved lazily by `saynow history` so synthesis is never delayed
            # by a second round trip just to learn the price.
            # camelCase to match the npm build: one index file, one key.
            "generationId": generation_id,
            "cost": None,
            "text": text[:300] + "…" if len(text) > 300 else text,
        }

        entries = [entry] + read_index()
        for stale in entries[limit:]:
            (directory / stale["file"]).unlink(missing_ok=True)
        _write_index(entries[:limit])
        return entry
    except OSError:
        return None


def _generation_id(entry: Dict[str, Any]) -> Optional[str]:
    """Accept either spelling: older clips were written with a snake_case key."""
    return entry.get("generationId") or entry.get("generation_id")


def resolve_costs(lookup) -> int:
    """Fill in prices for clips that have a generation id but no cost yet."""
    entries = read_index()
    # Null means "not priced yet"; zero is a real price, which a generation
    # that produced no audio genuinely has.
    pending = [e for e in entries if _generation_id(e) and e.get("cost") is None]
    if not pending:
        return 0

    resolved = 0
    for entry in pending:
        cost = lookup(_generation_id(entry))
        if cost is not None:
            entry["cost"] = cost
            resolved += 1

    if resolved:
        try:
            _write_index(entries)
        except OSError:
            pass  # a read-only archive is not worth failing over
    return resolved


def total_cost() -> float:
    return sum(e.get("cost") or 0 for e in read_index())


def clear() -> int:
    entries = read_index()
    directory = history_dir()
    for entry in entries:
        (directory / entry["file"]).unlink(missing_ok=True)
    index_path().unlink(missing_ok=True)
    return len(entries)


def usage() -> int:
    return sum(entry.get("bytes", 0) for entry in read_index())


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.0f} KB"
    return f"{size / 1024 / 1024:.1f} MB"
