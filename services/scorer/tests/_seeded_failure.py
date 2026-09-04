"""A deliberately failing test, run only as a subprocess by `test_gate_can_fail.py`.

Named with a leading underscore so unittest discovery (`test*.py`) never collects it. This is
the seeded failure F01 §5 asks for: proof that a red scorer lane is capable of turning the
overall gate red, rather than an assumption that it would.
"""

import unittest


class SeededFailure(unittest.TestCase):
    def test_this_must_fail(self):
        self.fail("seeded failure — if this is ever green, the scorer lane gates nothing")


if __name__ == "__main__":
    unittest.main()
