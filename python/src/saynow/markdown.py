"""Markdown, in the two forms saynow needs: prose to speak and HTML to show.

A port of src/markdown.js. Both halves must agree with it, since --file is
documented once and the two builds are meant to be the same tool.
"""

from __future__ import annotations

import re
from typing import Callable, List, Optional

_ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}

# Schemes that cannot execute. Anything else, including javascript:, is dropped.
_SAFE_LINK = re.compile(r"^(https?:|mailto:|#)", re.I)
_SAFE_IMAGE = re.compile(r"^(https?:|data:image/(png|jpe?g|gif|webp|svg\+xml);)", re.I)

# A URL carrying a quote is refused outright rather than relying on entity
# semantics to hold an injection shut. No real Markdown link needs one.
_QUOTED = re.compile(r"""&quot;|&#39;|["'`<>]""")


def _escape(text: str) -> str:
    return "".join(_ESCAPES.get(c, c) for c in str(text))


def _inline(text: str, asset: Optional[Callable[[str], Optional[str]]] = None) -> str:
    codes: List[str] = []

    def stash(m):
        codes.append(f"<code>{m.group(1)}</code>")
        return f"\x00{len(codes) - 1}\x00"

    out = re.sub(r"`([^`]+)`", stash, _escape(text))

    def image(m):
        alt, src = m.group(1), m.group(2)
        if _QUOTED.search(src):
            return alt
        resolved = src if _SAFE_IMAGE.match(src) else (asset(src) if asset else None)
        if not resolved:
            return alt
        return f'<img src="{resolved}" alt="{alt}" loading="lazy">'

    out = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)\)", image, out)

    def link(m):
        label, href = m.group(1), m.group(2)
        if not _SAFE_LINK.match(href) or _QUOTED.search(href):
            return label
        return f'<a href="{href}" target="_blank" rel="noreferrer noopener">{label}</a>'

    out = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"(^|\W)_([^_]+)_(?=\W|$)", r"\1<em>\2</em>", out)
    out = re.sub(r"(^|[^*])\*([^*]+)\*", r"\1<em>\2</em>", out)
    out = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: codes[int(m.group(1))], out)


def _cells(line: str) -> List[str]:
    return [c.strip() for c in re.sub(r"^\||\|$", "", line).split("|")]


def render(markdown: str, asset: Optional[Callable[[str], Optional[str]]] = None) -> str:
    """Render to HTML that is safe to insert, having been built rather than
    passed through. Mirrors src/markdown.js so both builds show the same thing.
    """
    lines = str(markdown).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    html: List[str] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        if re.match(r"^\s*```", line):
            body = []
            i += 1
            while i < len(lines) and not re.match(r"^\s*```\s*$", lines[i]):
                body.append(lines[i])
                i += 1
            i += 1
            html.append(f"<pre><code>{_escape(chr(10).join(body))}</code></pre>")
            continue

        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            html.append(f"<h{level}>{_inline(heading.group(2), asset)}</h{level}>")
            i += 1
            continue

        if re.match(r"^\s*([-*_])\1{2,}\s*$", line):
            html.append("<hr>")
            i += 1
            continue

        if "|" in line and i + 1 < len(lines) and re.match(r"^\s*\|?[\s:|-]+\|[\s:|-]*$", lines[i + 1]):
            head = _cells(line)
            i += 2
            body = []
            while i < len(lines) and "|" in lines[i]:
                body.append(_cells(lines[i]))
                i += 1
            head_html = "".join(f"<th>{_inline(c, asset)}</th>" for c in head)
            body_html = "".join(
                "<tr>" + "".join(f"<td>{_inline(c, asset)}</td>" for c in row) + "</tr>"
                for row in body
            )
            html.append(f"<table><thead><tr>{head_html}</tr></thead><tbody>{body_html}</tbody></table>")
            continue

        bullet = re.match(r"^\s*[-*+]\s+(.*)$", line)
        numbered = re.match(r"^\s*\d+[.)]\s+(.*)$", line)
        if bullet or numbered:
            ordered = bool(numbered)
            pattern = r"^\s*\d+[.)]\s+(.*)$" if ordered else r"^\s*[-*+]\s+(.*)$"
            items = []
            while i < len(lines):
                m = re.match(pattern, lines[i])
                if not m:
                    break
                items.append(f"<li>{_inline(m.group(1), asset)}</li>")
                i += 1
            tag = "ol" if ordered else "ul"
            html.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue

        if re.match(r"^\s*>\s?", line):
            body = []
            while i < len(lines):
                m = re.match(r"^\s*>\s?(.*)$", lines[i])
                if not m:
                    break
                body.append(m.group(1))
                i += 1
            html.append(f"<blockquote>{_inline(' '.join(body), asset)}</blockquote>")
            continue

        body = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^\s*([#>`|]|[-*+]\s|\d+[.)]\s)", lines[i]):
            body.append(lines[i].strip())
            i += 1
        if body:
            html.append(f"<p>{_inline(' '.join(body), asset)}</p>")
        else:
            i += 1

    return "\n".join(html)



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
