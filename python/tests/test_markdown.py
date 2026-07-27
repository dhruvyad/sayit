"""Markdown, in both the forms saynow needs.

speech() is what gets read aloud; render() is what gets shown. Both must
agree with src/markdown.js — --file is documented once, and a document that
looks different depending on how saynow was installed is a bug.
"""

import re
import unittest
from pathlib import Path

from saynow.markdown import render, speech

FIXTURES = Path(__file__).resolve().parents[2] / "test" / "fixtures"


def _asset(src: str):
    return None if re.match(r"^[a-z][\w+.-]*:", src, re.I) else f"/asset?p={src}"


class SpeechTest(unittest.TestCase):
    def test_keeps_prose_and_drops_what_cannot_be_heard(self):
        spoken = speech(
            "# Title\n\nSee the [full report](https://example.com/very/long/url).\n\n"
            "![a chart](chart.png)\n\n```\nnpm install --global\n```\n\n- one\n- two"
        )
        self.assertIn("Title", spoken)
        self.assertIn("full report", spoken)
        self.assertNotIn("example.com", spoken, "a URL read aloud is noise")
        self.assertNotIn("chart.png", spoken, "an image cannot be spoken")
        self.assertNotIn("npm install", spoken, "a code block read aloud is gibberish")
        self.assertIn("one two", spoken)

    def test_no_markup_survives(self):
        spoken = speech("**bold** _italic_ `code`\n\n> quoted\n\n## heading")
        for ch in "#*_`":
            self.assertNotIn(ch, spoken, f"{ch!r} should not be spoken")
        self.assertNotIn("> quoted", spoken, "the blockquote marker should go")
        self.assertIn("quoted", spoken, "but its text is still prose")

    def test_a_literal_greater_than_survives(self):
        # Only a line-leading ">" is a blockquote. Mid-line it is prose —
        # stripping it would turn "if x > y" into "if x y".
        self.assertIn(">", speech("Fails when x > y."))

    def test_maths_delimiters_are_dropped_but_prices_are_not(self):
        # "$$E = mc^2$$" aloud is "dollar dollar E equals m c squared".
        self.assertEqual(speech("The bound is $$E = mc^2$$."), "The bound is E = mc^2.")
        self.assertEqual(speech("It costs $40 to run."), "It costs $40 to run.")

    def test_matches_the_npm_build_on_a_table(self):
        spoken = speech("| Region | Change |\n| --- | --- |\n| US | +0.4% |")
        self.assertIn("Region", spoken)
        self.assertIn("+0.4%", spoken)
        self.assertNotIn("|", spoken)


class RenderTest(unittest.TestCase):
    def test_matches_the_npm_build_byte_for_byte(self):
        # The fixture is the agreement between the two renderers; the npm
        # suite pins the same bytes in test/assets.test.js. A change to
        # either renderer has to be made in both, or one of them fails.
        markdown = (FIXTURES / "document.md").read_text(encoding="utf-8")
        expected = (FIXTURES / "document.html").read_text(encoding="utf-8")
        self.assertEqual(render(markdown, asset=_asset) + "\n", expected)

    def test_raw_html_is_shown_rather_than_executed(self):
        html = render("<script>alert(1)</script><img src=x onerror=alert(1)>")
        # Grepping for "onerror" would flag the escaped text, which is inert
        # and correct. What matters is which tags were actually emitted.
        emitted = {m.lower() for m in re.findall(r"<([a-z]+)", html, re.I)}
        self.assertEqual(emitted, {"p"})
        self.assertIn("&lt;script&gt;", html, "it should still be readable as text")

    def test_a_link_that_could_run_code_is_dropped_to_its_label(self):
        for href in ("javascript:alert(1)", "data:text/html,<script>", "vbscript:x"):
            html = render(f"[click me]({href})")
            self.assertNotIn("<a", html, f"{href} must not become a link")
            self.assertIn("click me", html)

    def test_a_quoted_url_is_refused_rather_than_escaped(self):
        html = render('[x](https://example.com/"onmouseover="alert(1))')
        self.assertNotIn("onmouseover", html)

    def test_a_relative_image_is_resolved_through_the_callback(self):
        # Only relative images reach the callback, which is why a bug there
        # left every other document working in the npm build.
        self.assertIn('src="/asset?p=chart.png"', render("![c](chart.png)", asset=_asset))
        self.assertNotIn("<img", render("![c](chart.png)"), "no callback, no image")

    def test_a_remote_image_needs_no_callback(self):
        html = render("![c](https://example.com/c.png)")
        self.assertIn('src="https://example.com/c.png"', html)

    def test_inline_code_is_not_confused_with_a_bare_number(self):
        # The placeholder is a NUL-delimited index, not " 0 " — with spaces,
        # "finished, 42 tests" would have swallowed the 42.
        html = render("Ran `npm ci` and 0 of 42 tests failed.")
        self.assertIn("<code>npm ci</code>", html)
        self.assertIn("0 of 42 tests failed", html)


if __name__ == "__main__":
    unittest.main()
