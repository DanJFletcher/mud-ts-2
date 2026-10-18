#!/usr/bin/env python3
"""Offline smoke/negative tests for the editorial puzzle validator."""
import copy
import json
import unittest
from pathlib import Path

from validate_puzzle_draft import analyze

SAMPLE = Path(__file__).resolve().parents[1] / "examples" / "rainkeeper-archive.draft.json"


class EditorialPuzzleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.draft = json.loads(SAMPLE.read_text(encoding="utf-8"))

    def test_example_reachable(self):
        errors, warnings, stats = analyze(self.draft)
        self.assertEqual([], errors)
        self.assertGreater(stats["reachable_states"], 1)
        self.assertIsNotNone(stats["shortest_solution"])

    def test_wrong_reference(self):
        bad = copy.deepcopy(self.draft)
        bad["solutions"][0]["actions"].append("teleport-into-archive")
        self.assertTrue(any("unknown action" in e for e in analyze(bad)[0]))

    def test_unreachable_completion(self):
        bad = copy.deepcopy(self.draft)
        bad["actions"] = [a for a in bad["actions"] if a["id"] not in ("pull-chain", "crawl-hatch")]
        bad["solutions"] = []
        self.assertTrue(any("not reachable" in e for e in analyze(bad)[0]))

    def test_dead_end(self):
        bad = copy.deepcopy(self.draft)
        bad["actions"] = [{"id": "trap", "requires": {}, "effects": {"pattern_known": True}, "feedback": "You freeze."}]
        bad["solutions"] = []
        self.assertTrue(any("dead-end" in e for e in analyze(bad)[0]))


if __name__ == "__main__":
    unittest.main()
