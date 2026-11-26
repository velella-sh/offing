import { readFileSync } from "node:fs";

const version = "offing.agent-guard.request.v1";
const responseVersion = "offing.agent-guard.response.v1";
const severities = ["info", "low", "medium", "high", "critical"];
const examples = new Map([
  ["pkg:npm/request", {
    reason: "request is deprecated.",
    severity: "high",
    replacement: "Native fetch or a maintained HTTP client",
    source: "https://www.npmjs.com/package/request",
  }],
  ["node:16", {
    reason: "Node.js 16 has reached end of life.",
    severity: "high",
    replacement: "A node image on a supported release line, such as node:22",
    source: "https://nodejs.org/en/about/eol",
  }],
]);

function knownProperties(value, names) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every((key) => names.includes(key));
}

function gateOf(request) {
  if (request.context !== undefined && !knownProperties(request.context, ["failOn"])) {
    throw new Error("invalid context");
  }
  const gate = request.context?.failOn === undefined ? "high" : request.context.failOn;
  if (gate !== "none" && !severities.includes(gate)) throw new Error("invalid blocking threshold");
  return gate;
}

function findSubject(request) {
  const { purl, snippet, language } = request;
  if (purl !== undefined) {
    if (snippet !== undefined || language !== undefined || typeof purl !== "string" || !/^pkg:[^/]+\/[^/]/.test(purl)) {
      throw new Error("invalid PURL request");
    }
    if (purl === "pkg:github/actions/checkout") return { warn: "Check again with the intended release." };
    if (purl === "pkg:github/actions/checkout@v5") return { allow: "No example rule covers this release." };
    const finding = examples.get(purl.split("@")[0]);
    return finding ? { finding } : { warn: "No lifecycle data in the example covers this package." };
  }
  if (!knownProperties(snippet, ["path", "content"]) ||
      typeof snippet.path !== "string" || !/^(?![A-Za-z]:)(?:(?!\.{1,2}(?:\/|$))[^/\\\x00]+\/)*(?!\.{1,2}$)[^/\\\x00]+$/.test(snippet.path) ||
      snippet.path.length > 256 || typeof snippet.content !== "string" || Buffer.byteLength(snippet.content) > 1_000_000 ||
      (language !== undefined && (typeof language !== "string" || language.length === 0 || language.length > 64))) {
    throw new Error("invalid snippet request");
  }
  const image = snippet.path === "Dockerfile" ? snippet.content.match(/^FROM\s+(node:\d+)\s*$/m)?.[1] : undefined;
  const finding = examples.get(image);
  return finding ? { finding } : { allow: "No lifecycle finding in this snippet within the example's coverage." };
}

function check(request) {
  if (!knownProperties(request, ["schemaVersion", "purl", "snippet", "language", "context"]) || request.schemaVersion !== version) {
    throw new Error("expected an Agent Guard v1 request");
  }
  const gate = gateOf(request);
  const { finding, warn, allow } = findSubject(request);
  const schemaVersion = responseVersion;
  if (!finding) return warn ? { schemaVersion, decision: "warn", reason: warn } : { schemaVersion, decision: "allow", reason: allow };
  const { reason, severity, replacement, source } = finding;
  const decision = gate !== "none" && severities.indexOf(severity) >= severities.indexOf(gate) ? "block" : "warn";
  return { schemaVersion, decision, reason, replacement, source };
}

try {
  const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(0)));
  console.log(JSON.stringify(check(request)));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
