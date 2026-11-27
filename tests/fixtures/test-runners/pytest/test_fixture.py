import unittest


class TestFixture(unittest.TestCase):
    def test_passing_example(self):
        self.assertEqual(2 + 2, 4)

    def test_failing_example(self):
        self.assertEqual(2 + 2, 5)
