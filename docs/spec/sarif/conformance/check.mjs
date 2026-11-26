#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const levels = new Map([
  ["critical", "error"],
  ["high", "error"],
  ["medium", "warning"],
  ["low", "note"],
  ["info", "note"],
]);
const optionalFields = ["endOfLifeDate", "source", "replacement"];
const ruleIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonBlank = (value) => typeof value === "string" && value.trim().length > 0;

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isEvidenceUrl(value) {
  return typeof value === "string" && /^https?:\/\/[^/?#\s]+/.test(value) && !/\s/.test(value) && URL.canParse(value);
}

function isRelativeUri(value) {
  if (!nonBlank(value) || /^\/|^[^/]*:|\\/.test(value)) return false;
  return !value.split("/").some((part) => part.replace(/%2e/gi, ".") === "..");
}

function checkLifecycle(item, path, level, errors) {
  const facts = item.properties?.offingLifecycle;
  const at = path + ".properties.offingLifecycle";
  if (!isObject(facts)) {
    errors.push(at + ": expected an object");
    return;
  }
  for (const name of Object.keys(facts)) {
    if (name !== "severity" && !optionalFields.includes(name)) errors.push(at + "[" + JSON.stringify(name) + "]: unknown property");
  }
  const expected = levels.get(facts.severity);
  if (!expected) errors.push(at + ".severity: expected critical, high, medium, low, or info");
  else if (level !== expected) errors.push(path + ": severity " + facts.severity + " requires SARIF level " + expected);

  if ("endOfLifeDate" in facts && !isCalendarDate(facts.endOfLifeDate)) {
    errors.push(at + ".endOfLifeDate: expected a valid YYYY-MM-DD calendar date");
  }
  if ("source" in facts && !isEvidenceUrl(facts.source)) errors.push(at + ".source: expected an absolute HTTP(S) URL");
  if ("replacement" in facts && !nonBlank(facts.replacement)) errors.push(at + ".replacement: expected a non-blank string");
}

function checkRule(rule, path, ids, errors) {
  if (!isObject(rule)) {
    errors.push(path + ": expected a rule object");
    return;
  }
  if (typeof rule.id !== "string" || !ruleIdPattern.test(rule.id)) errors.push(path + ".id: invalid lifecycle rule ID");
  else if (ids.has(rule.id)) errors.push(path + ".id: duplicate rule ID " + rule.id);
  else ids.add(rule.id);

  checkLifecycle(rule, path, rule.defaultConfiguration?.level, errors);
  const source = rule.properties?.offingLifecycle?.source;
  if (source !== undefined && rule.helpUri !== undefined && source !== rule.helpUri) {
    errors.push(path + ".helpUri: must match the lifecycle source");
  }
}

function checkLocation(location, path, errors) {
  const physical = location?.physicalLocation;
  if (!isRelativeUri(physical?.artifactLocation?.uri)) {
    errors.push(path + ".physicalLocation.artifactLocation.uri: expected a repository-relative URI");
  }
  const line = physical?.region?.startLine;
  if (line !== undefined && (!Number.isInteger(line) || line < 1)) {
    errors.push(path + ".physicalLocation.region.startLine: expected a positive integer");
  }
}

function checkResult(result, path, rules, errors) {
  if (!isObject(result)) {
    errors.push(path + ": expected a result object");
    return;
  }
  if (typeof result.ruleId !== "string" || !Number.isInteger(result.ruleIndex) || result.ruleIndex < 0 ||
      rules[result.ruleIndex]?.id !== result.ruleId) {
    errors.push(path + ": ruleId and ruleIndex must reference the same rule");
  }
  if (!nonBlank(result.message?.text)) errors.push(path + ".message.text: expected a non-blank string");
  if (!nonBlank(result.partialFingerprints?.["offingFindingId/v1"])) {
    errors.push(path + ".partialFingerprints: missing offingFindingId/v1");
  }
  if (!Array.isArray(result.locations) || result.locations.length === 0) {
    errors.push(path + ".locations: expected at least one location");
  } else {
    result.locations.forEach((location, i) => checkLocation(location, path + ".locations[" + i + "]", errors));
  }
  checkLifecycle(result, path, result.level, errors);
}

/** Report violations of the Offing v1 lifecycle profile. Use the SARIF schema for base-format validation. */
export function validateLifecycleSarif(log) {
  if (!isObject(log) || log.version !== "2.1.0" || !Array.isArray(log.runs)) {
    return ["$: expected a SARIF 2.1.0 object with a runs array"];
  }

  const errors = [];
  log.runs.forEach((run, index) => {
    const at = "$.runs[" + index + "]";
    const driver = run?.tool?.driver;
    const rules = driver?.rules;
    const results = run?.results;
    if (!nonBlank(driver?.name)) errors.push(at + ".tool.driver.name: expected a non-blank string");
    if (!Array.isArray(rules)) errors.push(at + ".tool.driver.rules: expected an array");
    if (!Array.isArray(results)) errors.push(at + ".results: expected an array");
    const ids = new Set();
    if (Array.isArray(rules)) rules.forEach((rule, i) => checkRule(rule, at + ".tool.driver.rules[" + i + "]", ids, errors));
    if (Array.isArray(results)) results.forEach((result, i) => checkResult(result, at + ".results[" + i + "]", rules ?? [], errors));
  });
  return errors;
}

const entry = process.argv[1];
if (entry && existsSync(entry) && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  const [file, ...extra] = process.argv.slice(2);
  if (!file || extra.length > 0) {
    console.error("Usage: node check.mjs <file.sarif>");
    process.exitCode = 2;
  } else {
    try {
      const errors = validateLifecycleSarif(JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")));
      if (errors.length > 0) {
        console.error(errors.join("\n"));
        process.exitCode = 1;
      } else {
        console.log("acc-sarif-profile: profile v1 passed");
      }
    } catch (error) {
      console.error(file + ": " + error.message);
      process.exitCode = 2;
    }
  }
}
