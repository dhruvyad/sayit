"""Audio playback and cross-process serialization of speech."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

PLAYERS = {
    "darwin": [("afplay", lambda f: [f])],
    "linux": [
        ("ffplay", lambda f: ["-nodisp", "-autoexit", "-loglevel", "quiet", f]),
        ("mpv", lambda f: ["--no-video", "--really-quiet", f]),
        ("mpg123", lambda f: ["-q", f]),
        ("paplay", lambda f: [f]),
        ("aplay", lambda f: ["-q", f]),
    ],
}

# One lock per machine by default, so every saynow process shares a queue
# regardless of whether it came from npm or pip. Override to give a project
# or test its own independent queue.
LOCK_PATH = Path(
    os.environ.get("SAYNOW_LOCK_PATH") or Path(tempfile.gettempdir()) / "saynow.lock"
)
STALE_SECONDS = 300
# A lock younger than this is never reclaimed — it may still be mid-creation.
GRACE_SECONDS = 2.0


def find_player():
    for name, args in PLAYERS.get(sys.platform, []):
        if shutil.which(name):
            return name, args
    return None


def play(path: str) -> None:
    found = find_player()
    if not found:
        tried = ", ".join(n for n, _ in PLAYERS.get(sys.platform, [])) or sys.platform
        raise SystemExit(
            f"saynow: no audio player found (looked for: {tried}).\n"
            "Install one, or use --save <file> to write the audio instead."
        )
    name, args = found
    result = subprocess.run([name, *args(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode != 0:
        raise SystemExit(f"saynow: {name} exited with code {result.returncode}")


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _clear_if_stale() -> None:
    try:
        age = time.time() - LOCK_PATH.stat().st_mtime
    except FileNotFoundError:
        return
    except OSError:
        return

    # The holder creates the file and writes to it as two steps, so for a moment
    # it is empty. Treating that as corrupt and deleting it would hand the lock
    # to a second process while the first still holds it — both would then speak
    # at once. Never reclaim a lock young enough to still be mid-creation.
    if age < GRACE_SECONDS:
        return

    try:
        holder = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return
    except (json.JSONDecodeError, OSError):
        # Old and unreadable: its owner died before finishing.
        LOCK_PATH.unlink(missing_ok=True)
        return

    expired = time.time() - holder.get("at", 0) > STALE_SECONDS
    if expired or not _alive(holder.get("pid", -1)):
        LOCK_PATH.unlink(missing_ok=True)


@contextmanager
def queued(enabled: bool = True, timeout: float = 120.0):
    """Serialize playback so concurrent invocations never overlap."""
    if not enabled:
        yield
        return

    deadline = time.time() + timeout
    while True:
        try:
            fd = os.open(str(LOCK_PATH), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, json.dumps({"pid": os.getpid(), "at": time.time()}).encode())
            os.close(fd)
            break
        except FileExistsError:
            _clear_if_stale()
            if time.time() > deadline:
                raise SystemExit(
                    f"saynow: timed out waiting for another saynow to finish (lock: {LOCK_PATH}).\n"
                    "Pass --no-queue to speak immediately without waiting."
                )
            time.sleep(0.06)

    try:
        yield
    finally:
        LOCK_PATH.unlink(missing_ok=True)
