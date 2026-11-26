import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { required } from "../../required.js";

import { loadDataFile } from "@velella/ebb/data-source";
import type { UnclassifiedReference } from "../../domain.js";
import { formatPurl } from "@velella/ebb/purl";
import { relativePosix } from "../../paths.js";
import { validateRegistryV2 } from "@velella/ebb/registry";
import type { RegistryV2Rule } from "@velella/ebb/registry";
import { DETECTOR_API_VERSION } from "../../sdk.js";
import type { Detector, DetectorAnalysis, DetectorContext, DetectorFinding, DetectorInputs } from "../../sdk.js";
import { analyzeSourceUsage } from "../../source-usage.js";
import { versContains } from "@velella/ebb/vers/index";
import { MISE_FILE_NAMES, MISE_FILES, miseDeclarations } from "../../version-files/mise.js";
import { jdkDeclaration, jdkRuleVersion } from "./jdk-version.js";
import type {
  DependencyDeclaration,
  DynamicJdkDeclaration,
  GradleWrapperDeclaration,
  JdkDeclaration,
  KotlinPluginDeclaration,
} from "./jdk-version.js";
import { parseCatalog, parseCatalogIndex } from "./parse-catalog.js";
import type { CatalogIndex, CatalogPluginDeclaration } from "./parse-catalog.js";
import { parseGradle } from "./parse-gradle.js";
import { parseJavaVersion, parseSdkmanrc, parseToolVersions } from "./parse-pins.js";
import { MAXIMUM_INPUT_BYTES, parsePom } from "./parse-pom.js";
import { parseWrapper } from "./parse-wrapper.js";

/**
 * Finds JDK feature releases that are out of support, Gradle wrapper versions, and Maven
 * dependencies that have moved.
 *
 * It reads the JDK a project pins or targets (`pom.xml`, `build.gradle(.kts)`, `.java-version`,
 * `.sdkmanrc`, `.tool-versions`, `mise.toml`, `.mise.toml`), Gradle version catalogs (`libs.versions.toml`),
 * Gradle wrappers (`gradle-wrapper.properties`), and direct Maven dependencies (decision 0009).
 * Nothing is built, resolved, or run.
 */

const MAXIMUM_DEPTH = 8;
const MAXIMUM_FILES = 2000;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".gradle",
  ".venv",
  "venv",
  "fixtures",
  "__fixtures__",
  "testdata",
]);
const JDK_PURL = "pkg:generic/java";
const GRADLE_PURL = "pkg:generic/gradle";

type LocatedDeclaration =
  | JdkDeclaration
  | DynamicJdkDeclaration
  | DependencyDeclaration
  | KotlinPluginDeclaration
  | CatalogPluginDeclaration
  | GradleWrapperDeclaration;

type Parser = (contents: string) => LocatedDeclaration[];

const PARSERS = new Map<string, Parser>([
  ["pom.xml", parsePom],
  ["libs.versions.toml", parseCatalog],
  ["gradle-wrapper.properties", parseWrapper],
  [".java-version", parseJavaVersion],
  [".sdkmanrc", parseSdkmanrc],
  [".tool-versions", parseToolVersions],
]);

const GRADLE_FILES = new Set(["build.gradle", "build.gradle.kts"]);

async function candidateFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAXIMUM_DEPTH || files.length >= MAXIMUM_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(join(directory, entry.name), depth + 1);
      } else if (
        entry.isFile() &&
        (PARSERS.has(entry.name) || GRADLE_FILES.has(entry.name) || MISE_FILE_NAMES.has(entry.name))
      ) {
        files.push(join(directory, entry.name));
      }
    }
  }
  await walk(root, 0);
  return files;
}

function rulesByPurl(rules: readonly RegistryV2Rule[]): Map<string, RegistryV2Rule[]> {
  const map = new Map<string, RegistryV2Rule[]>();
  for (const rule of rules) map.set(rule.purl, [...(map.get(rule.purl) ?? []), rule]);
  return map;
}

function matches(rule: RegistryV2Rule, version: string): boolean {
  try {
    return versContains(rule.vers, version);
  } catch {
    return false;
  }
}

const ROLE_TEXT = {
  toolchain: "the JDK that builds the project",
  pin: "the pinned JDK",
  "compile-level": "the language level the code is compiled for",
} as const;

async function readJavaFile(file: string): Promise<string | undefined> {
  try {
    if ((await stat(file)).size > MAXIMUM_INPUT_BYTES) return undefined;
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

interface Located {
  path: string;
  declaration: LocatedDeclaration;
}

function mergeCatalogs(indexes: readonly CatalogIndex[]): CatalogIndex | undefined {
  if (indexes.length === 0) return undefined;
  const versions = new Map<string, string>();
  const libraries = new Map<string, DependencyDeclaration>();
  const plugins = new Map<string, CatalogPluginDeclaration>();
  for (const idx of indexes) {
    for (const [k, v] of idx.versions) versions.set(k, v);
    for (const [k, v] of idx.libraries) libraries.set(k, v);
    for (const [k, v] of idx.plugins) plugins.set(k, v);
  }
  return { versions, libraries, plugins };
}

async function collectDeclarations(
  root: string,
  unclassified: Array<Omit<UnclassifiedReference, "detector">>,
): Promise<Located[]> {
  const files = await candidateFiles(root);
  const loaded: Array<{ path: string; name: string; contents: string }> = [];
  const catalogs: CatalogIndex[] = [];
  for (const file of files) {
    const contents = await readJavaFile(file);
    if (contents === undefined) continue;
    const name = basename(file);
    if (name === "libs.versions.toml") catalogs.push(parseCatalogIndex(contents));
    loaded.push({ path: relativePosix(root, file), name, contents });
  }
  const mergedCatalog = mergeCatalogs(catalogs);
  const miseParsers = new Map([
    [
      JDK_PURL,
      (pin: { value: string; line: number }) => {
        const d = jdkDeclaration("pin", pin.value, pin.line);
        return d ? [d] : [];
      },
    ],
  ]);

  const located: Located[] = [];
  for (const { path, name, contents } of loaded) {
    const declarations: LocatedDeclaration[] = GRADLE_FILES.has(name)
      ? parseGradle(contents, mergedCatalog)
      : MISE_FILE_NAMES.has(name)
        ? miseDeclarations(path, contents, miseParsers, unclassified)
        : required(PARSERS.get(name), "parser")(contents);
    for (const declaration of declarations) located.push({ path, declaration });
  }
  return located;
}

interface Judgment {
  subject: string;
  candidates: RegistryV2Rule[] | undefined;
  version: string;
  severityOf: (rule: RegistryV2Rule) => RegistryV2Rule["severity"];
}

type Verdict =
  | Judgment
  | { dynamic: DynamicJdkDeclaration }
  | { noData: { component: string; reference: string; reason: string; line: number } };

function judgeDeclaration(
  rules: ReadonlyMap<string, RegistryV2Rule[]>,
  declaration: LocatedDeclaration,
): Verdict | undefined {
  if (declaration.kind === "dynamic") return { dynamic: declaration };
  if (declaration.kind === "jdk") {
    const jdk = declaration;
    return {
      candidates: rules.get(JDK_PURL),
      version: jdkRuleVersion(jdk.major),
      subject: `JDK ${jdk.value}, ${ROLE_TEXT[jdk.role]},`,
      severityOf: jdk.role === "compile-level" ? () => "medium" : (rule) => rule.severity,
    };
  }
  if (declaration.kind === "dependency") {
    const dependency = declaration;
    return {
      candidates: rules.get(formatPurl({ type: "maven", namespace: dependency.group, name: dependency.artifact })),
      version: dependency.version,
      subject: `${dependency.group}:${dependency.artifact}:${dependency.version}`,
      severityOf: (rule) => rule.severity,
    };
  }
  if (declaration.kind === "gradle-wrapper") {
    const wrapper = declaration;
    const candidates = rules.get(GRADLE_PURL);
    if (!candidates || candidates.length === 0) {
      return {
        noData: {
          component: GRADLE_PURL,
          reference: wrapper.value,
          reason: "no-data: Ebb has no lifecycle rule for Gradle",
          line: wrapper.line,
        },
      };
    }
    return {
      candidates,
      version: wrapper.value,
      subject: `Gradle ${wrapper.value}`,
      severityOf: (rule) => rule.severity,
    };
  }
  return undefined;
}

async function attachUsage(
  root: string,
  findings: readonly DetectorFinding[],
  withUsage: ReadonlyArray<{ id: string; rule: RegistryV2Rule }>,
): Promise<void> {
  const analyses = new Map(
    (
      await analyzeSourceUsage(
        root,
        withUsage.map((item) => ({ id: item.id, matchers: item.rule.usage ?? [] })),
      )
    ).map((analysis) => [analysis.contractId, analysis]),
  );
  for (const finding of findings) {
    const analysis = analyses.get(finding.id);
    if (analysis) Object.assign(finding, { usages: analysis.usages, impact: analysis.impact });
  }
}

export class JavaDetector implements Detector {
  readonly apiVersion = DETECTOR_API_VERSION;
  readonly id = "java";
  /** The files `scan` may read; conformance fails a scan that reads another. */
  readonly inputs: DetectorInputs = {
    fileNames: [
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "libs.versions.toml",
      "gradle-wrapper.properties",
      ".java-version",
      ".sdkmanrc",
      ".tool-versions",
      ...MISE_FILES,
    ],
    sourceExtensions: [".java", ".kt"],
  };

  constructor(
    private readonly loadRules: () => Promise<RegistryV2Rule[]> = async () =>
      validateRegistryV2(await loadDataFile("registry/java.json")).rules,
  ) {}

  async scan(context: DetectorContext): Promise<DetectorFinding[]> {
    return [...(await this.analyze(context)).findings];
  }

  async analyze(context: DetectorContext): Promise<DetectorAnalysis> {
    const unclassified: Omit<UnclassifiedReference, "detector">[] = [];
    const located = await collectDeclarations(context.root, unclassified);
    if (located.length === 0 && unclassified.length === 0) return { findings: [], unclassified: [] };

    const rules = rulesByPurl(await this.loadRules());
    const findings: DetectorFinding[] = [];
    const withUsage: Array<{ id: string; rule: RegistryV2Rule }> = [];

    for (const { path, declaration } of located) {
      const judgment = judgeDeclaration(rules, declaration);
      if (!judgment) continue;
      if ("dynamic" in judgment) {
        unclassified.push({
          component: "java",
          reference: judgment.dynamic.value,
          reason: `the JDK version of ${ROLE_TEXT[judgment.dynamic.role]} is a property, expression, or floating value, which Offing does not expand`,
          location: { path, line: declaration.line },
        });
        continue;
      }
      if ("noData" in judgment) {
        const { component, reference, reason, line } = judgment.noData;
        unclassified.push({ component, reference, reason, location: { path, line } });
        continue;
      }

      const rule = judgment.candidates?.find((item) => matches(item, judgment.version));
      if (!rule) continue;
      const id = `${rule.id}:${path}:${declaration.line}`;
      if ((rule.usage ?? []).length > 0) withUsage.push({ id, rule });
      findings.push({
        id,
        ruleId: rule.id,
        title: rule.title,
        summary: `${path} declares ${judgment.subject}. ${rule.summary}`,
        severity: judgment.severityOf(rule),
        location: { path, line: declaration.line },
        ...(rule.replacement ? { replacement: rule.replacement } : {}),
        ...(rule.deadline ? { deadline: rule.deadline } : {}),
        ...(rule.migration ? { migration: rule.migration } : {}),
        sources: rule.sources,
      });
    }

    await attachUsage(context.root, findings, withUsage);
    return { findings, unclassified };
  }
}

export const javaDetector = new JavaDetector();
