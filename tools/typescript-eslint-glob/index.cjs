// typescript-eslint 8.72.1 uses these two functions to expand parserOptions.project.
// The pinned parser is the only consumer; this package implements its project-file interface.
const { globSync: find, hasMagic } = require("glob");

exports.isDynamicPattern = (pattern) => hasMagic(pattern, { magicalBraces: true });

exports.globSync = (pattern, options = {}) => {
  const { cwd, expandDirectories, ignore = [] } = options;
  const supported = new Set(["cwd", "expandDirectories", "ignore"]);
  for (const key of Object.keys(options)) {
    if (!supported.has(key)) throw new Error(`Unsupported typescript-eslint glob option: ${key}`);
  }
  if (expandDirectories !== false) {
    throw new Error("typescript-eslint project globs must set expandDirectories to false");
  }
  return find(pattern, { cwd, ignore, nodir: true, dot: false })
    .map((path) => path.replaceAll("\\", "/"))
    .sort();
};
