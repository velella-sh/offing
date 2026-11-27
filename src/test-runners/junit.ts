import { readXml, walk, type XmlElement } from "../detectors/dotnet/msbuild-xml.js";

interface TestIdentity {
  name: string;
  file: string | null;
}

export interface FailedTest extends TestIdentity {
  message: string;
}

export interface TestTotals {
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
}

function attribute(element: XmlElement, key: string): string | undefined {
  return element.attributes.get(key)?.value || undefined;
}

function identify(testCase: XmlElement): TestIdentity {
  const name = attribute(testCase, "name") ?? "(unnamed test)";
  const className = attribute(testCase, "classname");
  const file = attribute(testCase, "file") ?? attribute(testCase, "filepath");
  return {
    name: (className ? `${className}::${name}` : name).slice(0, 1024),
    file: file?.replaceAll("\\", "/").slice(0, 4096) ?? null,
  };
}

/** Tests are identified by the report's case name and optional source path. */
export function testKey(test: TestIdentity): string {
  return JSON.stringify([test.name, test.file]);
}

function isCase(node: XmlElement): boolean {
  if (node.name !== "testcase" || !node.parent) return false;
  const { parent } = node;
  return parent.name === "testsuite" || (parent.name === "testsuites" && !parent.parent);
}

/** Accepts bounded JUnit XML; a missing or invalid document signals fallback to the process outcome. */
export function parseJUnit(contents: string, candidates: ReadonlySet<string>) {
  const document = readXml(contents);
  if (!document || (document.name !== "testsuite" && document.name !== "testsuites")) return undefined;
  const totals: TestTotals = { tests: 0, passed: 0, failed: 0, skipped: 0 };
  const failures: FailedTest[] = [];
  const repaired = new Set<string>();
  const stillFailing = new Set<string>();
  for (const testCase of walk(document)) {
    if (!isCase(testCase)) continue;
    totals.tests += 1;
    const failure = testCase.children.find((node) => node.name === "failure" || node.name === "error");
    if (failure) {
      totals.failed += 1;
      const message = attribute(failure, "message") ?? (failure.text.trim() || "Test failed.");
      const identity = identify(testCase);
      const key = testKey(identity);
      if (candidates.has(key)) stillFailing.add(key);
      failures.push({ ...identity, message: message.slice(0, 4096) });
    } else if (testCase.children.some((node) => node.name === "skipped")) totals.skipped += 1;
    else {
      totals.passed += 1;
      if (candidates.size) {
        const key = testKey(identify(testCase));
        if (candidates.has(key)) repaired.add(key);
      }
    }
  }
  return { totals, failures, repaired, stillFailing };
}
