import importlib
import types
import importlib.util
import sys

module = importlib.reload(existing)
created = types.ModuleType("example")
magic = importlib.util.MAGIC_NUMBER
tag = sys.implementation.cache_tag
cache = importlib.util.cache_from_source("module.py")
source = importlib.util.source_from_cache("module.pyc")
