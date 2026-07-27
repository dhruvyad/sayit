"""The pip build cannot show a document, but it must be able to read one.

Silently accepting --file and doing nothing was worse than refusing it: a
caller would believe a report had been delivered when nothing was said.
"""

import unittest

from saynow.markdown import speech


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


if __name__ == "__main__":
    unittest.main()
