"""F01 §5: "the scorer lane runs, and a seeded failure in it turns the overall gate red".

A CI lane nobody has ever seen fail is a lane nobody has shown to work. This runs the seeded
failure in a subprocess and asserts the runner exits non-zero — the signal the workflow reads.
"""

from __future__ import annotations

import pathlib
import subprocess
import sys
import unittest

SERVICE_ROOT = pathlib.Path(__file__).resolve().parent.parent


class TheLaneCanGoRed(unittest.TestCase):
    def test_a_seeded_failure_exits_non_zero(self):
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "tests._seeded_failure", "-v"],
            cwd=SERVICE_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(
            result.returncode,
            0,
            "the seeded failure passed — the scorer lane cannot turn the gate red",
        )
        self.assertIn("seeded failure", result.stderr + result.stdout)

    def test_the_real_suite_exits_zero(self):
        result = subprocess.run(
            [sys.executable, "-m", "unittest", "tests.test_contract"],
            cwd=SERVICE_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
