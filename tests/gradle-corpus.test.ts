import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";

import type { RegistryV2Rule } from "@velella/ebb/registry";
import { AndroidDetector, androidDetector } from "../src/detectors/android/index.js";
import { parseAndroidBuildGradle } from "../src/detectors/android/parse-build-gradle.js";
import { parseAndroidLibsVersionsToml } from "../src/detectors/android/parse-libs-versions-toml.js";
import { JavaDetector, javaDetector } from "../src/detectors/java/index.js";
import { parseCatalog, parseCatalogIndex } from "../src/detectors/java/parse-catalog.js";
import { parseGradle } from "../src/detectors/java/parse-gradle.js";
import { scanWithBuiltIns } from "../src/scan-builtins.js";
import { copyFixtureTree } from "./fixture-copies.js";

let gradleFixtures: string;
const temporaryRoots: string[] = [];

before(async () => {
  gradleFixtures = await copyFixtureTree(resolve("tests/fixtures/gradle/repos"), temporaryRoots);
});

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "offing-gradle-"));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

test("parseCatalog reads [plugins], multi-line inline tables, and [section.alias] sub-tables with lines", () => {
  const toml = [
    "[versions]",
    'java = "16"',
    'springBoot = "2.7.18"',
    'agp = "8.5.2"',
    "",
    "[libraries]",
    "spring-boot = {",
    '  group = "org.springframework.boot",',
    '  name = "spring-boot",',
    '  version.ref = "springBoot"',
    "}",
    "",
    "[libraries.slf4j-log4j12]",
    'module = "org.slf4j:slf4j-log4j12"',
    'version = "2.0.13"',
    "",
    "[plugins]",
    'kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "1.9.24" }',
    "android-app = {",
    '  id = "com.android.application",',
    '  version.ref = "agp"',
    "}",
    "",
    "[plugins.android-lib]",
    'id = "com.android.library"',
    'version.ref = "agp"',
  ].join("\n");

  assert.deepEqual(parseCatalog(toml), [
    {
      kind: "dependency",
      group: "org.springframework.boot",
      artifact: "spring-boot",
      version: "2.7.18",
      line: 7,
    },
    {
      kind: "dependency",
      group: "org.slf4j",
      artifact: "slf4j-log4j12",
      version: "2.0.13",
      line: 13,
    },
    {
      kind: "catalog-plugin",
      alias: "kotlin-jvm",
      id: "org.jetbrains.kotlin.jvm",
      version: "1.9.24",
      line: 18,
    },
    {
      kind: "catalog-plugin",
      alias: "android-app",
      id: "com.android.application",
      version: "8.5.2",
      line: 19,
    },
    {
      kind: "catalog-plugin",
      alias: "android-lib",
      id: "com.android.library",
      version: "8.5.2",
      line: 24,
    },
  ]);

  assert.deepEqual(parseAndroidLibsVersionsToml(toml), [
    { kind: "agp", value: "8.5.2", line: 4 },
    { kind: "agp", value: "8.5.2", line: 19 },
    { kind: "agp", value: "8.5.2", line: 24 },
  ]);
});

test("parseGradle resolves libs.* references in both Groovy DSL and Kotlin DSL", () => {
  const catalog = parseCatalogIndex(
    [
      "[versions]",
      'java = "16"',
      'compat = "15"',
      "",
      "[libraries]",
      'spring-boot = { group = "org.springframework.boot", name = "spring-boot", version = "2.7.18" }',
      "",
      "[plugins]",
      'kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version = "1.9.24" }',
    ].join("\n"),
  );

  const groovy = [
    "plugins {",
    "  alias libs.plugins.kotlin.jvm",
    "}",
    "java {",
    "  toolchain {",
    "    languageVersion = JavaLanguageVersion.of(libs.versions.java.get())",
    "  }",
    "  sourceCompatibility = libs.versions.compat.get()",
    "}",
    "dependencies {",
    "  implementation libs.spring.boot",
    "}",
  ].join("\n");

  const kotlin = [
    "plugins {",
    "  alias(libs.plugins.kotlin.jvm)",
    "}",
    "kotlin {",
    "  jvmToolchain(libs.versions.java.get().toInt())",
    "}",
    "java {",
    "  targetCompatibility = JavaVersion.toVersion(libs.versions.compat.get())",
    "}",
    "dependencies {",
    "  implementation(libs.spring.boot)",
    "}",
  ].join("\n");

  assert.deepEqual(parseGradle(groovy, catalog), [
    { kind: "kotlin-plugin", value: "1.9.24", line: 2 },
    { kind: "jdk", role: "toolchain", value: "16", major: 16, line: 6 },
    { kind: "jdk", role: "compile-level", value: "15", major: 15, line: 8 },
    { kind: "dependency", group: "org.springframework.boot", artifact: "spring-boot", version: "2.7.18", line: 11 },
  ]);

  assert.deepEqual(parseGradle(kotlin, catalog), [
    { kind: "kotlin-plugin", value: "1.9.24", line: 2 },
    { kind: "jdk", role: "toolchain", value: "16", major: 16, line: 5 },
    { kind: "jdk", role: "compile-level", value: "15", major: 15, line: 8 },
    { kind: "dependency", group: "org.springframework.boot", artifact: "spring-boot", version: "2.7.18", line: 11 },
  ]);
});

test("parseAndroidBuildGradle reads compileSdk(34) and legacy *Version forms in Groovy and Kotlin DSL", () => {
  const groovy = [
    "android {",
    "  compileSdkVersion 34",
    '  buildToolsVersion "34.0.0"',
    "  defaultConfig {",
    "    minSdkVersion 21",
    "    targetSdkVersion 33",
    "  }",
    "}",
  ].join("\n");

  const kotlin = [
    "android {",
    "  compileSdk(34)",
    '  buildToolsVersion("34.0.0")',
    "  defaultConfig {",
    "    minSdk(21)",
    "    targetSdk(33)",
    "  }",
    "}",
  ].join("\n");

  const expected = [
    { kind: "compileSdk", value: "34", line: 2 },
    { kind: "buildToolsVersion", value: "34.0.0", line: 3 },
    { kind: "minSdk", value: "21", line: 5 },
    { kind: "targetSdk", value: "33", line: 6 },
  ];

  assert.deepEqual(parseAndroidBuildGradle(groovy), expected);
  assert.deepEqual(parseAndroidBuildGradle(kotlin), expected);
});

test("reports Gradle wrapper and AGP EOL when Ebb has a rule, and no-data otherwise", async (t) => {
  const root = await tempRepo({
    "gradle/wrapper/gradle-wrapper.properties":
      "distributionUrl=https\\://services.gradle.org/distributions/gradle-7.6.4-bin.zip\n",
    "settings.gradle.kts": 'plugins {\n  id("com.android.application") version "8.1.0"\n}\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  // Without Gradle/AGP rules in bundled Ebb, both emit explicit no-data unclassified references.
  const javaAnalysis = await javaDetector.analyze({ root });
  assert.equal(javaAnalysis.findings.length, 0);
  assert.deepEqual(javaAnalysis.unclassified, [
    {
      component: "pkg:generic/gradle",
      reference: "7.6.4",
      reason: "no-data: Ebb has no lifecycle rule for Gradle",
      location: { path: "gradle/wrapper/gradle-wrapper.properties", line: 1 },
    },
  ]);

  const androidAnalysis = await androidDetector.analyze({ root });
  assert.equal(androidAnalysis.findings.length, 0);
  assert.deepEqual(androidAnalysis.unclassified, [
    {
      component: "pkg:generic/android/agp",
      reference: "8.1.0",
      reason: "no-data: Ebb has no lifecycle rule for Android Gradle Plugin",
      location: { path: "settings.gradle.kts", line: 2 },
    },
  ]);

  // With Ebb rules injected, both produce EOL findings instead of no-data.
  const gradleRule: RegistryV2Rule = {
    id: "gradle.eol-7",
    ecosystem: "java",
    purl: "pkg:generic/gradle",
    vers: "vers:semver/<8.0.0",
    event: "end-of-support",
    title: "Gradle 7 is end of life",
    summary: "Gradle 7 is unsupported.",
    severity: "high",
    sources: [{ title: "Gradle releases", url: "https://gradle.org/releases/" }],
    provenance: { observedAt: "2026-11-01", reviewedAt: "2026-11-01", reviewer: "test" },
  };
  const agpRule: RegistryV2Rule = {
    id: "android.agp.eol-8.1",
    ecosystem: "android",
    purl: "pkg:generic/android/agp",
    vers: "vers:semver/<8.2.0",
    event: "end-of-support",
    title: "AGP 8.1 is end of life",
    summary: "AGP 8.1 is unsupported.",
    severity: "high",
    sources: [{ title: "AGP releases", url: "https://developer.android.com/build/releases/gradle-plugin" }],
    provenance: { observedAt: "2026-11-01", reviewedAt: "2026-11-01", reviewer: "test" },
  };

  const javaWithRule = await new JavaDetector(async () => [gradleRule]).analyze({ root });
  assert.equal(javaWithRule.findings.length, 1);
  assert.equal(javaWithRule.findings[0]?.ruleId, "gradle.eol-7");
  assert.deepEqual(javaWithRule.unclassified, []);

  const androidWithRule = await new AndroidDetector(async () => [agpRule]).analyze({ root });
  assert.equal(androidWithRule.findings.length, 1);
  assert.equal(androidWithRule.findings[0]?.ruleId, "android.agp.eol-8.1");
  assert.deepEqual(androidWithRule.unclassified, []);
});

interface CorpusExpectation {
  name: string;
  findings: Array<[string, string, number]>;
  unclassified: Array<[string, string, string, number]>;
}

const CORPUS_EXPECTATIONS: CorpusExpectation[] = [
  {
    name: "01-spring-boot-groovy",
    findings: [
      ["java.jdk.end-of-support-12-16", "build.gradle", 2],
      ["java.maven.mysql.mysql-connector-java.relocated", "build.gradle", 5],
    ],
    unclassified: [["pkg:generic/gradle", "8.5", "gradle/wrapper/gradle-wrapper.properties", 1]],
  },
  {
    name: "02-spring-boot-kotlin-catalog",
    findings: [
      ["java.jdk.end-of-support-12-16", "build.gradle.kts", 5],
      ["java.maven.spring-boot.legacy-2x.end-of-support", "build.gradle.kts", 8],
      ["java.maven.spring-boot.legacy-2x.end-of-support", "gradle/libs.versions.toml", 6],
    ],
    unclassified: [],
  },
  {
    name: "03-android-compose-kotlin",
    findings: [["android.target-sdk.existing.default-below-35", "build.gradle.kts", 4]],
    unclassified: [
      ["pkg:generic/android/agp", "8.5.2", "gradle/libs.versions.toml", 2],
      ["pkg:generic/android/agp", "8.5.2", "gradle/libs.versions.toml", 5],
      ["pkg:generic/android/agp", "8.5.2", "settings.gradle.kts", 2],
    ],
  },
  {
    name: "04-android-legacy-groovy",
    findings: [
      ["android.play-billing.version-5", "build.gradle", 10],
      ["android.target-sdk.existing.default-below-35", "build.gradle", 5],
    ],
    unclassified: [],
  },
  {
    name: "05-mise-and-tool-versions",
    findings: [
      ["java.jdk.end-of-support-12-16", "mise.toml", 2],
      ["java.jdk.end-of-support-22-24", ".tool-versions", 1],
    ],
    unclassified: [],
  },
  {
    name: "06-lts-control-catalog",
    findings: [],
    unclassified: [],
  },
  {
    name: "07-multiline-subtable-catalog",
    findings: [
      ["java.maven.org.slf4j.slf4j-log4j12.relocated", "build.gradle", 2],
      ["java.maven.org.slf4j.slf4j-log4j12.relocated", "gradle/libs.versions.toml", 1],
    ],
    unclassified: [],
  },
  {
    name: "08-false-positive-guards",
    findings: [],
    unclassified: [],
  },
  {
    name: "09-wrapper-and-dynamic",
    findings: [],
    unclassified: [
      ["java", "libs.versions.missing.get()", "build.gradle.kts", 2],
      ["pkg:generic/gradle", "7.6.4", "gradle/wrapper/gradle-wrapper.properties", 1],
    ],
  },
  {
    name: "10-android-billing-and-agp-catalog",
    findings: [["android.play-billing.version-6", "build.gradle.kts", 8]],
    unclassified: [
      ["pkg:generic/android/agp", "8.7.0", "gradle/libs.versions.toml", 2],
      ["pkg:generic/android/agp", "8.7.0", "gradle/libs.versions.toml", 4],
    ],
  },
];

test("ten real Gradle repository fixtures match reviewed findings with zero false positives", async () => {
  for (const entry of CORPUS_EXPECTATIONS) {
    const root = resolve(gradleFixtures, entry.name);
    const result = await scanWithBuiltIns(root, { noCache: true });
    assert.deepEqual(
      result.findings.map((f) => [f.ruleId, f.location.path, f.location.line]),
      entry.findings,
      `${entry.name} findings`,
    );
    assert.deepEqual(
      (result.unclassified?.references ?? []).map((u) => [u.component, u.reference, u.location.path, u.location.line]),
      entry.unclassified,
      `${entry.name} unclassified`,
    );
  }
});
