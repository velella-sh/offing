import semver from "semver";

import type { Finding } from "../../../domain.js";
import { collectIniRuntime } from "../../../detectors/python/parse-ini.js";
import type { IniFile } from "../../../detectors/python/parse-ini.js";
import type { Refuse } from "../../types.js";

const SIMPLE_BOUND = /^(>=\s*)(\d+\.\d+(?:\.\d+)?)$/;
const TOX_FACTOR = /(^|-)py(\d{2,3}|\{\d{2,3}(?:,\s*\d{2,3})*\})(?=-|$)/g;
const TOX_ENVIRONMENT = /(?:[^,\s{}]+|\{[^{}]*\})+/g;

function raiseSetupCfg(line: string, original: string, supported: string): string | undefined {
  const bound = SIMPLE_BOUND.exec(original);
  if (!bound) return undefined;
  const assignment = /^(\s*python_requires\s*[=:]\s*)([^#;]+)(.*)$/.exec(line);
  if (assignment?.[2]?.trimEnd() !== original) return undefined;
  return line.replace(original, `${bound[1]}${supported}`);
}

function raiseTox(line: string, versions: ReadonlySet<string>, supported: string): string {
  const match = /^(\s*(?:envlist|env_list)\s*[=:]\s*|\s*)(.*?)(\s*(?:[#;].*)?\r?)$/.exec(line);
  const environments = match?.[2];
  if (!environments) return line;
  const replacement = supported.replace(".", "");
  const update = (environment: string): string =>
    environment.replace(TOX_FACTOR, (_, prefix: string, pin: string) => {
      const pins = pin.replace(/[{}]/g, "").split(/,\s*/);
      const changed = pins.map((key) => (versions.has(`${key[0]}.${Number(key.slice(1))}`) ? replacement : key));
      if (changed.every((key, index) => key === pins[index])) return `${prefix}py${pin}`;
      const unique = [...new Set(changed)];
      return `${prefix}py${unique.length === 1 ? unique[0] : `{${unique.join(",")}}`}`;
    });
  const updated = environments.replace(TOX_ENVIRONMENT, update);
  return `${match[1]}${updated}${match[3]}`;
}

/** Only edit options the existing INI parser assigned to the affected project's Python runtime. */
export function rewritePythonIni(
  name: IniFile,
  path: string,
  source: string,
  findings: readonly Finding[],
  supported: string,
  refuse: Refuse | undefined,
): string {
  const lines = source.split("\n");
  const declarations = collectIniRuntime(path, source, name);
  for (const line of new Set(findings.map((finding) => finding.location.line ?? 0))) {
    const original = lines[line - 1];
    const values = declarations.filter((declaration) => declaration.line === line).map(({ value }) => value);
    const edited = original === undefined ? undefined : editLine(name, original, values, supported);
    if (edited !== undefined && edited !== original) {
      lines[line - 1] = edited;
      continue;
    }
    for (const finding of findings.filter((entry) => (entry.location.line ?? 0) === line)) {
      refuse?.(
        finding,
        name === "setup.cfg"
          ? "The python_requires constraint needs a single literal lower bound."
          : "The tox environment is not a supported literal Python version or factor.",
      );
    }
  }
  return lines.join("\n");
}

function editLine(name: IniFile, line: string, values: string[], supported: string): string | undefined {
  if (name === "setup.cfg") return values[0] === undefined ? undefined : raiseSetupCfg(line, values[0], supported);
  const versions = new Set(values.filter((value) => semver.lt(`${value}.0`, `${supported}.0`)));
  return raiseTox(line, versions, supported);
}
