import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { bundledRules } from "@velella/ebb/bundled-rules";
import { getActiveData } from "@velella/ebb/data-source";
import { dataInfoFrom } from "@velella/ebb/data-status";

import { checkAgainst } from "./check-dependency.js";
import type { Finding, ScanResult, UnclassifiedReference } from "./domain.js";
import { OffingError } from "./offing-error.js";
import { relativePosix } from "./paths.js";
import { findingOrder } from "./reporters/shared.js";
import { scanSbomInput } from "./sbom/input.js";
import type { SbomComponentCheck } from "./sbom/input.js";

const MAX_SBOM_BYTES = 64 * 1024 * 1024;

function findingsFor(path: string, component: SbomComponentCheck): Finding[] {
  if (component.status !== "affected") return [];
  // SPDX's low-level reader identifies the external reference. Reports locate the package itself.
  const jsonPointer = component.location.split("/externalRefs/", 1)[0] ?? component.location;
  return component.findings.map(({ ruleId, title, summary, severity, sources, deadline, replacement, migration }) => ({
    id: `${ruleId}:${path}#${jsonPointer}`,
    ruleId,
    title,
    summary,
    severity,
    sources,
    detector: "sbom",
    confidence: "exact",
    location: { path, jsonPointer },
    ...(deadline === undefined ? {} : { deadline }),
    ...(replacement === undefined ? {} : { replacement }),
    ...(migration === undefined ? {} : { migration }),
  }));
}

async function scanSbom(input: unknown, root: string, path: string): Promise<ScanResult> {
  const rules = await bundledRules();
  const unclassified: UnclassifiedReference[] = [];
  const checked = await scanSbomInput(input, {
    check: (component) => checkAgainst(rules, component),
    onMissingPurl: (component, jsonPointer) => {
      unclassified.push({
        detector: "sbom",
        component,
        reference: jsonPointer,
        reason: "Missing PURL",
        location: { path, jsonPointer },
      });
    },
  });
  const findings = new Map<string, Finding>();
  for (const component of checked) {
    for (const finding of findingsFor(path, component)) findings.set(finding.id, finding);
  }
  return {
    schemaVersion: "offing.scan.v1",
    root,
    scannedAt: new Date().toISOString(),
    findings: [...findings.values()].sort(findingOrder),
    diagnostics: unclassified.map(
      ({ component, reference }) => `Skipped ${JSON.stringify(component)} at ${reference}: missing PURL.`,
    ),
    data: dataInfoFrom(await getActiveData()),
    ...(unclassified.length === 0 ? {} : { unclassified: { count: unclassified.length, references: unclassified } }),
    coverage: { ecosystems: [], filesRead: [path], unsupportedFiles: [] },
  };
}

async function readInput(stream: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    if (length > MAX_SBOM_BYTES) throw new Error("SBOM exceeds the 64 MiB input limit.");
    chunks.push(chunk);
  }
  return JSON.parse(
    Buffer.concat(chunks)
      .toString("utf8")
      .replace(/^\uFEFF/, ""),
  );
}

function outsideRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith("../") || isAbsolute(relative);
}

/** Scan a local file or stdin without executing a generator or accessing the network. */
export async function scanSbomFile(file: string, root = process.cwd(), workspaceOnly = false): Promise<ScanResult> {
  const absolute = resolve(root, file);
  const relative = relativePosix(root, absolute);
  let input: unknown;
  try {
    if (file === "-" && workspaceOnly) throw new Error("The Action requires a workspace file.");
    if (workspaceOnly && outsideRoot(relativePosix(await realpath(root), await realpath(absolute)))) {
      throw new Error("The SBOM must be inside the scan root.");
    }
    if (file !== "-" && !(await stat(absolute)).isFile()) throw new Error("Expected a regular SBOM file.");
    input = await readInput(file === "-" ? process.stdin : createReadStream(absolute));
  } catch (error) {
    throw new OffingError(
      "invalid-sbom",
      `Cannot read SBOM ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (file === "-") return scanSbom(input, root, "stdin.sbom.json");
  if (outsideRoot(relative)) return scanSbom(input, dirname(absolute), basename(absolute));
  return scanSbom(input, root, relative);
}
