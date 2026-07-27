"""Turning a Markdown document into the prose to speak.

The pip build has no bubble, so it cannot show a document — but it can read
one. Rendering lives only in the npm build; this is the half that works
everywhere, and keeps --file from silently doing nothing here.
"""

from __future__ import annotations

import re


def speech(markdown: str) -> str:
    """The prose to speak.

    Images are dropped rather than described, link URLs give way to their text,
    and code blocks are skipped: read aloud they are unintelligible and would
    bury whatever the message actually was.
    """
    text = str(markdown).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"^\s*\|.*\|\s*$", lambda m: m.group(0).replace("|", " "), text, flags=re.M)
    text = re.sub(r"^\s*[-:|\s]+$", " ", text, flags=re.M)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"^\s*>\s?", "", text, flags=re.M)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.M)
    text = re.sub(r"^\s*\d+[.)]\s+", "", text, flags=re.M)
    # Maths is not rendered, but "$$E = mc^2$$" read aloud becomes "dollar
    # dollar E equals m c squared", which is worse than saying nothing.
    text = re.sub(r"\$\$([^$]+)\$\$", r"\1", text)
    text = re.sub(r"\$([^$\n]+)\$", r"\1", text)
    text = re.sub(r"[*_~`]", "", text)
    return re.sub(r"\s+", " ", text).strip()
