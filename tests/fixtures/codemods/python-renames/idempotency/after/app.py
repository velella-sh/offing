import configparser
import io
import unittest


class Example(unittest.TestCase):
    def test_value(self):
        self.assertEqual(actual, expected)


parser = configparser.ConfigParser()
stream = io.open(path)
