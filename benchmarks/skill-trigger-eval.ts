import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const skillEvalHosts = ["agent-skills", "codex", "claude"] as const;
export type SkillEvalHost = (typeof skillEvalHosts)[number];
export type SkillEvalKind = "positive" | "negative" | "ambiguous";

export interface SkillEvalCase {
  id: string;
  host: SkillEvalHost;
  kind: SkillEvalKind;
  prompt: string;
  shouldTrigger: boolean;
  reason: string;
}

export interface SkillEvalCorpus {
  schemaVersion: "offing.skill-evals.v2";
  cases: SkillEvalCase[];
}

export interface SkillTriggerMetrics {
  cases: number;
  expectedTriggers: number;
  expectedNonTriggers: number;
  truePositives: number;
  falsePositives: number;
  recall: number;
  falseTriggerRate: number;
}

const deprecationTerms = [/\bdeprecated?\b/, /\bdeprecation\b/];

const lifecycleStatusTerms = [
  /\bend[ -]of[ -](?:life|support)\b/,
  /\beol\b/,
  /\bout[ -]of[ -](?:support|maintenance)\b/,
  /\bunsupported\b/,
  /\bstill (?:support|supports)\b/,
  /\b(?:still |actively |currently |already )?supported\b/,
  /\b(?:still |actively |currently |already )?maintained\b/,
  /\b(?:receiving|gets?|getting) (?:security )?(?:updates|fixes|patches|support)\b/,
  /\bretired?\b/,
  /\bsunset\b/,
  /\bobsolete\b/,
  /\bno longer (?:supported|maintained|updated)\b/,
  /\bmaintenance (?:has )?ended\b/,
  /\bend of maintenance\b/,
  /\bmaintenance (?:status|window|mode)\b/,
  /\bsupport (?:window|status)\b/,
  /\bpast (?:its )?(?:support|end[ -]of[ -]life)\b/,
  /\b(?:stops?|stopped) (?:receiving|getting) (?:updates|fixes|support)\b/,
  /\blifecycle status\b/,
];

const lifecycleTerms = [...deprecationTerms, ...lifecycleStatusTerms];

const repositoryDependencyTerms = [
  /\brepositor(?:y|ies)\b/,
  /\brepo\b/,
  /\bruntimes?\b/,
  /\bnode(?:\.js|js)?\b/,
  /\bpython\b/,
  /\bpackage(?:s| declarations?)?\b/,
  /\bdependenc(?:y|ies)\b/,
  /\bgithub actions?\b/,
  /\bactions\/[\w-]+\b/,
  /\bworkflows?\b/,
  /\bmanifests?\b/,
  /\bpackage\.json\b/,
  /\brequirements(?:\.txt)?\b/,
  /\bpyproject(?:\.toml)?\b/,
  /\bnvmrc\b/,
  /\blockfiles?\b/,
  /\b(?:dockerfile|container(?: image)?|base image)\b/,
  /\bci (?:action|pipeline|configuration)\b/,
  /\btoolchain\b/,
];

const offingFindingTerms = [
  /\boffing (?:finding|scan|report|context|migration|verification)\b/,
  /\bfinding id\b/,
  /\b(?:deprecation|lifecycle|end[ -]of[ -]life|eol|retirement|support) finding\b/,
  /\b(?:this|that|selected|reported|same|current) finding\b/,
  /\bmigration (?:packet|context)\b[^.?!]*\b(?:finding|deprecation|lifecycle)\b/,
  /\b(?:finding|deprecation|lifecycle)\b[^.?!]*\bmigration (?:packet|context)\b/,
  /\bverify (?:that )?(?:this |the )?(?:deprecation|finding|lifecycle)\b/,
];

const securityTerms = [
  /\bvulnerabilit(?:y|ies)\b/,
  /\bsecurity audit\b/,
  /\bcve-?\d*/,
  /\bsnyk\b/,
  /\bosv\b/,
  /\bdependabot alert\b/,
];

const sourceApiTerms = [
  /\bdeprecated (?:[\w.-]+ ){0,2}(?:apis?|methods?|functions?|components?|props?|hooks?|endpoints?|classes?)\b/,
  /\b(?:apis?|methods?|functions?|components?|props?|hooks?|endpoints?|classes?) (?:is|are|was|were|has been|have been) deprecated\b/,
  /\bdeprecated (?:[\w.-]+ ){0,2}(?:scripts?|commands?|config(?:uration)?s?|settings?|fields?|features?|flags?|tests?)\b/,
  /\b(?:scripts?|commands?|config(?:uration)?s?|settings?|fields?|features?|flags?|tests?) (?:is|are|was|were|has been|have been) deprecated\b/,
  /\bdeprecat(?:e|es|ing) (?:the |our |this )?(?:[\w.-]+ ){0,2}(?:apis?|methods?|functions?|components?|props?|hooks?|endpoints?|classes?|scripts?|commands?|config(?:uration)?s?|settings?|fields?|features?|flags?|tests?)\b/,
];

const routineUpgradeTerms = [
  /\b(?:upgrade|update|bump) (?:all |every |the )?(?:dependencies|dependency|packages?)\b/,
  /\blatest (?:version|versions|release)\b/,
  /\brefresh (?:the )?lockfile\b/,
  /\brenovate\b/,
];

function matchesAny(prompt: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prompt));
}

/**
 * Deterministic proxy for metadata-only skill selection. It intentionally uses
 * concepts stated in the skill description, not case IDs or expected labels.
 * A lifecycle status is required for source-API and configuration requests to
 * count as triggers, so a deprecated hook or npm script stays a non-goal even
 * when the repository uses a supported runtime.
 */
export function classifySkillTrigger(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replaceAll("’", "'");
  const hasLifecycle = matchesAny(normalized, lifecycleTerms);
  const hasLifecycleStatus = matchesAny(normalized, lifecycleStatusTerms);
  const hasRepositoryDependency = matchesAny(normalized, repositoryDependencyTerms);
  const hasOffingFinding = matchesAny(normalized, offingFindingTerms);

  if (matchesAny(normalized, securityTerms) && !hasLifecycle && !hasOffingFinding) {
    return false;
  }
  if (matchesAny(normalized, sourceApiTerms) && !hasLifecycleStatus && !hasOffingFinding) {
    return false;
  }
  if (matchesAny(normalized, routineUpgradeTerms) && !hasLifecycle && !hasOffingFinding) {
    return false;
  }

  return hasOffingFinding || (hasLifecycle && hasRepositoryDependency);
}

// --- Dependency guard: should an agent check a dependency before this task? -------------------------------

export interface DependencyEvalCorpus {
  schemaVersion: "offing.dependency-guard-evals.v1";
  cases: SkillEvalCase[];
}

const packageManagerCommand =
  /\b(?:npm|pnpm|yarn|bun|pip3?|pipx|poetry|uv|cargo|gem|go)\s+(?:install|add|i|get)\b(?:\s+-{1,2}[\w-]+)*\s+(?!and\b|then\b|the\b|before\b|to\b|from\b|in\b|so\b|if\b|for\b|again\b)[@\w.\/-]*[a-z]/;
const addVerb =
  /\b(?:add|install|introduce|include|adopt|pull in|bring in|switch to|swap in|pick|choose|start using|use)\b/;
const dependencyNoun = /\b(?:package|library|dependency|dependencies|github action|action|npm package|pypi package)\b/;
const namedPackageAfterVerb =
  /\b(?:install|pull in|bring in|introduce|adopt|include|start using)\s+(?:the |a |an )?(?!all\b|dependencies\b|packages\b)[@\w.\/-]*[-.@\/][@\w.\/-]+/;
const addToManifest =
  /\b(?:add|put|append)\b[^.?!]{0,50}\bto\b[^.?!]{0,20}\b(?:requirements(?:\.txt)?|package\.json|pyproject(?:\.toml)?|dependencies|devdependencies|go\.mod|cargo\.toml)\b/;
const actionReference = /\b(?:add|use|include|insert)\b[^.?!]{0,40}\b(?:actions\/[\w.-]+|[\w.-]+\/[\w.-]+@v?\d)/;
const choosePackage =
  /\b(?:which|what) (?:package|library|module)\b[^.?!]*\b(?:use|pick|choose|adopt)\b|\breplace\b[^.?!]{0,40}\bwith\b[^.?!]{0,30}\b(?:package|library|module)\b/;
const notAnAddition = [
  /\bdependency injection\b/,
  /\b(?:from the lockfile|project's dependencies|all (?:the )?dependencies|declared dependencies)\b/,
  /\b(?:upgrade|update|bump)\b[^.?!]*\b(?:latest|all)\b/,
  /\b(?:remove|uninstall|delete|drop)\b[^.?!]*\b(?:package|packages|dependency|dependencies)\b(?![^.?!]*\b(?:add|install|pick|choose|replace)\b)/,
];

/**
 * Deterministic proxy for the check-before-add workflow in the `offing` Skill description: the task adds a new
 * package, runtime, or action, or picks one. Removals, installs of what is already declared, routine
 * upgrades, repository lifecycle scans, and unrelated work do not trigger it. Like the lifecycle
 * proxy above, it encodes the concepts the skill states, not case IDs.
 */
export function classifyDependencyAddition(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replaceAll("’", "'");
  if (
    matchesAny(normalized, notAnAddition) &&
    !packageManagerCommand.test(normalized) &&
    !addToManifest.test(normalized)
  ) {
    return choosePackage.test(normalized);
  }
  const strongAdd =
    packageManagerCommand.test(normalized) ||
    addToManifest.test(normalized) ||
    actionReference.test(normalized) ||
    choosePackage.test(normalized) ||
    namedPackageAfterVerb.test(normalized);
  if (strongAdd) {
    return true;
  }
  // Weak "use/add … action/package" phrasing must not steal repository lifecycle prompts
  // ("may use an unsupported action") from offing. Positive status words
  // like "maintained" still appear when picking a package to add, so they stay allowed.
  const lifecycleInvestigation = [
    ...deprecationTerms,
    /\bend[ -]of[ -](?:life|support)\b/,
    /\beol\b/,
    /\bout[ -]of[ -](?:support|maintenance)\b/,
    /\bunsupported\b/,
    /\bretired?\b/,
    /\bsunset\b/,
    /\bobsolete\b/,
    /\bno longer (?:supported|maintained|updated)\b/,
    /\bmaintenance (?:has )?ended\b/,
    /\bend of maintenance\b/,
    /\bpast (?:its )?(?:support|end[ -]of[ -]life)\b/,
    /\blifecycle status\b/,
  ];
  if (matchesAny(normalized, lifecycleInvestigation)) {
    return false;
  }
  return addVerb.test(normalized) && dependencyNoun.test(normalized.replace(/package\.json/g, ""));
}

export function calculateMetrics(
  cases: SkillEvalCase[],
  classify: (prompt: string) => boolean = classifySkillTrigger,
): SkillTriggerMetrics {
  const predictions = cases.map((item) => ({
    expected: item.shouldTrigger,
    actual: classify(item.prompt),
  }));
  const expectedTriggers = predictions.filter((item) => item.expected).length;
  const expectedNonTriggers = predictions.length - expectedTriggers;
  const truePositives = predictions.filter((item) => item.expected && item.actual).length;
  const falsePositives = predictions.filter((item) => !item.expected && item.actual).length;

  return {
    cases: predictions.length,
    expectedTriggers,
    expectedNonTriggers,
    truePositives,
    falsePositives,
    recall: expectedTriggers === 0 ? 0 : truePositives / expectedTriggers,
    falseTriggerRate: expectedNonTriggers === 0 ? 0 : falsePositives / expectedNonTriggers,
  };
}

export async function loadSkillEvalCorpus(): Promise<SkillEvalCorpus> {
  return JSON.parse(await readFile(resolve("skills/offing/evals/cases.json"), "utf8")) as SkillEvalCorpus;
}

export async function loadDependencyEvalCorpus(): Promise<DependencyEvalCorpus> {
  return JSON.parse(
    await readFile(resolve("skills/offing/evals/check-before-add.json"), "utf8"),
  ) as DependencyEvalCorpus;
}

export interface UpgradeRuntimeActionEvalCorpus {
  schemaVersion: "offing.upgrade-runtime-action-evals.v1";
  cases: SkillEvalCase[];
}

const upgradeIntent = /\b(?:upgrade|bump|update|raise|migrate|move|replace)\b/;
const runtimeUpgradeTarget =
  /\b(?:runtimes?|node(?:\.js|js)?|python|interpreter|engines(?:\.node)?|(?:\.?nvmrc)|requires-python|(?:\.?python-version)|(?:dockerfile|container(?: image)?|base image))\b/;
const actionUpgradeTarget =
  /\bgithub actions?\b|\bactions\/[\w.-]+\b|\bworkflow actions?\b|\b(?:upgrade|bump|update|migrate|replace|find)\b[^.?!]{0,40}\bactions?\b|\bactions?\b[^.?!]{0,40}\b(?:ci|workflow|workflows|pinned|sunset|retired|deprecated|end[ -]of[ -]life)\b/;
const packageWideUpgrade =
  /\b(?:upgrade|update|bump)\b[^.?!]*\b(?:all |every )?(?:dependencies|dependency|packages?)\b(?![^.?!]*\b(?:runtime|node|python|action|actions|workflow)\b)/;
const packageNameBump =
  /\b(?:upgrade|bump|update)\b[^.?!]{0,30}\b(?!node|python|runtime|actions?(?:\/|\b)|github)[@\w.-]*[a-z][@\w.\/-]*\b(?:to|for)\b/;

/**
 * Deterministic proxy for the upgrade workflow in the `offing` Skill: the task upgrades an already-declared
 * runtime or GitHub Action. Additions, whole-repo lifecycle discovery without an upgrade ask, and
 * routine package bumps stay out. Encodes the skill description concepts, not case IDs.
 */
export function classifyRuntimeActionUpgrade(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replaceAll("’", "'");
  if (classifyDependencyAddition(normalized)) {
    return false;
  }
  if (
    packageWideUpgrade.test(normalized) &&
    !runtimeUpgradeTarget.test(normalized) &&
    !actionUpgradeTarget.test(normalized)
  ) {
    return false;
  }
  if (
    packageNameBump.test(normalized) &&
    !runtimeUpgradeTarget.test(normalized) &&
    !actionUpgradeTarget.test(normalized)
  ) {
    return false;
  }
  if (!upgradeIntent.test(normalized)) {
    return false;
  }
  return runtimeUpgradeTarget.test(normalized) || actionUpgradeTarget.test(normalized);
}

export async function loadUpgradeRuntimeActionEvalCorpus(): Promise<UpgradeRuntimeActionEvalCorpus> {
  return JSON.parse(
    await readFile(resolve("skills/offing/evals/upgrade-runtime-action.json"), "utf8"),
  ) as UpgradeRuntimeActionEvalCorpus;
}

/** Share of upgrade-job positives that `offing` already covers (decision threshold: 80%). */
export function deprecationCoverageOnUpgradeJob(cases: SkillEvalCase[]): {
  cases: number;
  covered: number;
  rate: number;
  misses: string[];
} {
  const positives = cases.filter((item) => item.shouldTrigger);
  const misses = positives.filter((item) => !classifySkillTrigger(item.prompt)).map((item) => item.id);
  const covered = positives.length - misses.length;
  return {
    cases: positives.length,
    covered,
    rate: positives.length === 0 ? 0 : covered / positives.length,
    misses,
  };
}

// --- Tool selection: does a tool's name and description lead a request to it? ------------------------------

/** The recorded answer of `tools/list`, which `tests/mcp.test.ts` holds equal to what the server advertises. */
export const ADVERTISED_TOOLS = "tests/fixtures/mcp-tool-schemas.json";

export interface ToolSelectionCase {
  id: string;
  prompt: string;
  /** The one tool that answers the prompt. */
  tool: string;
  reason: string;
}

export interface ToolSelectionCorpus {
  schemaVersion: "offing.mcp-tool-selection.v1";
  cases: ToolSelectionCase[];
}

/** What the selection reads of a tool: what a host shows an agent before it calls anything. */
export interface AdvertisedTool {
  name: string;
  title?: string;
  description: string;
}

export interface ToolSelectionMetrics {
  cases: number;
  selected: number;
  selectionRate: number;
  /** How many prompts have their tool among the first three, a shortlist a host could still tell apart. */
  inFirstThree: number;
  /** Where the tool of a prompt ranks on average, 1 being first of all tools. */
  meanRank: number;
  /** Per tool: how many prompts name it, and for how many it ranked first. */
  byTool: Record<string, { cases: number; selected: number }>;
  /** The prompts whose tool did not rank first, with what ranked first instead; none when two tie. */
  misses: Array<{ id: string; expected: string; selected?: string }>;
}

/** Words that carry grammar and not meaning. A word that appears in one description only would otherwise count for it. */
const STOP_WORDS = new Set(
  `
  a an the this that these those it its they them their we our us you your i me my he she his her is are was were
  be been being am do does did done have has had will would can could should shall may might must of in on at by for
  with from to into over under about as and or but if then than so not no any all some one every each here there
  when where which what who how why again still also just please need want tell show give make
`.split(/\s+/),
);

/** Two words are one term when they share this many letters at the start: `deprecated` and `deprecation` are, while
 * `check` and `checkout` are not. */
const SHARED_PREFIX = 6;
const INFLECTIONS = ["s", "es", "ed", "ing"];

/** Whether `longer` is `shorter` with a plural or a tense ending: `plan`/`planning`, `line`/`lines`. */
function isInflection(shorter: string, longer: string): boolean {
  const stem = shorter.endsWith("e") ? shorter.slice(0, -1) : shorter;
  return INFLECTIONS.some((ending) => longer === stem + ending || longer === stem + stem.at(-1) + ending);
}

function sameTerm(left: string, right: string): boolean {
  if (left === right) return true;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  if (isInflection(shorter, longer)) return true;
  let shared = 0;
  while (shared < Math.min(left.length, right.length) && left[shared] === right[shared]) shared += 1;
  return shared >= SHARED_PREFIX;
}

/** The words of a text that can tell one tool from another, each once: lower case, split at punctuation and at the
 * seams of a tool name, and without the words of grammar. */
function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((word) => !STOP_WORDS.has(word));
}

/** How much a word of a prompt tells tools apart: nothing when no tool uses it or every tool does, and more the
 * fewer tools use it. */
function termWeight(word: string, termsOfTools: readonly (readonly string[])[]): number {
  const toolsUsingIt = termsOfTools.filter((terms) => terms.some((term) => sameTerm(word, term))).length;
  return toolsUsingIt === 0 || toolsUsingIt === termsOfTools.length ? 0 : Math.log(termsOfTools.length / toolsUsingIt);
}

/**
 * Ranks the tools for a prompt by their name, title, and description. Each word of the prompt counts for every tool
 * that uses the word, weighted by how few tools do.
 *
 * This is a deterministic stand-in for the first step of a host's choice, which is to match a request against what a
 * tool says about itself. It reads no code, it has no notion of order between calls, and it never declines a prompt
 * on its own, so it measures the wording of the descriptions and nothing else.
 */
export function rankTools(prompt: string, tools: readonly AdvertisedTool[]): Array<{ name: string; score: number }> {
  const text = (tool: AdvertisedTool) => [tool.name, tool.title ?? "", tool.description].join(" ");
  const termsOfTools = tools.map((tool) => words(text(tool)));
  const weights = new Map(words(prompt).map((word) => [word, termWeight(word, termsOfTools)]));
  return tools
    .map((tool, index) => ({
      name: tool.name,
      score: [...weights].reduce(
        (sum, [word, weight]) =>
          sum + (weight > 0 && termsOfTools[index]?.some((term) => sameTerm(word, term)) ? weight : 0),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

/** The one tool that ranks first, or undefined when two tie or no word of the prompt appears in any tool. */
function leader(ranked: ReturnType<typeof rankTools>): string | undefined {
  const first = ranked[0];
  if (!first || first.score === 0 || first.score === ranked[1]?.score) return undefined;
  return first.name;
}

export function selectTool(prompt: string, tools: readonly AdvertisedTool[]): string | undefined {
  return leader(rankTools(prompt, tools));
}

/** The selection rate is the share of prompts whose tool ranks first. The rank of the tool and its place in a
 * shortlist of three say how close the rest came. */
export function calculateToolSelection(
  cases: readonly ToolSelectionCase[],
  tools: readonly AdvertisedTool[],
): ToolSelectionMetrics {
  const byTool: Record<string, { cases: number; selected: number }> = {};
  const misses: ToolSelectionMetrics["misses"] = [];
  let rankSum = 0;
  let inFirstThree = 0;
  for (const item of cases) {
    const ranked = rankTools(item.prompt, tools);
    const rank = Math.max(1, ranked.findIndex((tool) => tool.name === item.tool) + 1);
    rankSum += rank;
    if (rank <= 3) inFirstThree += 1;
    const tally = (byTool[item.tool] ??= { cases: 0, selected: 0 });
    tally.cases += 1;
    const selected = leader(ranked);
    if (selected === item.tool) tally.selected += 1;
    else misses.push({ id: item.id, expected: item.tool, ...(selected ? { selected } : {}) });
  }
  const selected = cases.length - misses.length;
  return {
    cases: cases.length,
    selected,
    selectionRate: cases.length === 0 ? 0 : selected / cases.length,
    inFirstThree,
    meanRank: cases.length === 0 ? 0 : rankSum / cases.length,
    byTool,
    misses,
  };
}

export async function loadToolSelectionCorpus(): Promise<ToolSelectionCorpus> {
  return JSON.parse(await readFile(resolve("benchmarks/mcp-tool-selection.json"), "utf8")) as ToolSelectionCorpus;
}

/** The tools in a recorded `tools/list` answer, in the shape the selection reads. */
export async function loadAdvertisedTools(path = ADVERTISED_TOOLS): Promise<AdvertisedTool[]> {
  const document = JSON.parse(await readFile(resolve(path), "utf8")) as AdvertisedTool[] | { tools: AdvertisedTool[] };
  const tools = Array.isArray(document) ? document : document.tools;
  return tools.map(({ name, title, description }) => ({ name, ...(title ? { title } : {}), description }));
}

async function run(): Promise<void> {
  const corpus = await loadSkillEvalCorpus();
  const overall = calculateMetrics(corpus.cases);
  const byHost = Object.fromEntries(
    skillEvalHosts.map((host) => [host, calculateMetrics(corpus.cases.filter((item) => item.host === host))]),
  );
  const failures = corpus.cases
    .filter((item) => classifySkillTrigger(item.prompt) !== item.shouldTrigger)
    .map((item) => item.id);
  const guardrail = await loadDependencyEvalCorpus();
  const guardrailOverall = calculateMetrics(guardrail.cases, classifyDependencyAddition);
  const guardrailByHost = Object.fromEntries(
    skillEvalHosts.map((host) => [
      host,
      calculateMetrics(
        guardrail.cases.filter((item) => item.host === host),
        classifyDependencyAddition,
      ),
    ]),
  );
  const guardrailFailures = guardrail.cases
    .filter((item) => classifyDependencyAddition(item.prompt) !== item.shouldTrigger)
    .map((item) => item.id);
  const upgradeJob = await loadUpgradeRuntimeActionEvalCorpus();
  const upgradeOverall = calculateMetrics(upgradeJob.cases, classifyRuntimeActionUpgrade);
  const upgradeByHost = Object.fromEntries(
    skillEvalHosts.map((host) => [
      host,
      calculateMetrics(
        upgradeJob.cases.filter((item) => item.host === host),
        classifyRuntimeActionUpgrade,
      ),
    ]),
  );
  const upgradeFailures = upgradeJob.cases
    .filter((item) => classifyRuntimeActionUpgrade(item.prompt) !== item.shouldTrigger)
    .map((item) => item.id);
  const deprecationOnUpgradeJob = deprecationCoverageOnUpgradeJob(upgradeJob.cases);
  const lifecycleOnAddPrompts = guardrail.cases.filter((item) => item.shouldTrigger);
  const addOnLifecyclePrompts = corpus.cases.filter((item) => item.shouldTrigger);
  const lifecycleFalseOnAdd = lifecycleOnAddPrompts.filter((item) => classifySkillTrigger(item.prompt));
  const addFalseOnLifecycle = addOnLifecyclePrompts.filter((item) => classifyDependencyAddition(item.prompt));
  const upgradeOnAdd = lifecycleOnAddPrompts.filter((item) => classifyRuntimeActionUpgrade(item.prompt));
  const addOnUpgrade = upgradeJob.cases.filter((item) => item.shouldTrigger && classifyDependencyAddition(item.prompt));
  // `--tools <file>` scores the tool list of another commit, which is how a before number is taken. Reported and
  // not gated: the ranking is a lexical stand-in, far from the floor the trigger evals above are held to.
  const toolsFlag = process.argv.indexOf("--tools");
  const tools = toolsFlag === -1 ? undefined : process.argv[toolsFlag + 1];
  const toolSelection = {
    tools: tools ?? ADVERTISED_TOOLS,
    ...calculateToolSelection((await loadToolSelectionCorpus()).cases, await loadAdvertisedTools(tools)),
  };
  const result = {
    schemaVersion: corpus.schemaVersion,
    skill: "offing",
    workflow: "scan-and-migrate",
    overall,
    byHost,
    failures,
    dependencyGuard: {
      schemaVersion: guardrail.schemaVersion,
      skill: "offing",
      workflow: "check-before-add",
      overall: guardrailOverall,
      byHost: guardrailByHost,
      failures: guardrailFailures,
    },
    upgradeRuntimeAction: {
      schemaVersion: upgradeJob.schemaVersion,
      skill: "offing",
      workflow: "upgrade-runtime-action",
      overall: upgradeOverall,
      byHost: upgradeByHost,
      failures: upgradeFailures,
      deprecationCoverage: {
        threshold: 0.8,
        ...deprecationOnUpgradeJob,
        decision: deprecationOnUpgradeJob.rate < 0.8 ? "separate-upgrade-workflow" : "scan-workflow-covers-upgrades",
      },
    },
    separation: {
      lifecycleFalseTriggersOnAddPrompts: lifecycleFalseOnAdd.map((item) => item.id),
      checkBeforeAddFalseTriggersOnLifecyclePrompts: addFalseOnLifecycle.map((item) => item.id),
      upgradeFalseTriggersOnAddPrompts: upgradeOnAdd.map((item) => item.id),
      checkBeforeAddFalseTriggersOnUpgradePrompts: addOnUpgrade.map((item) => item.id),
    },
    toolSelection,
  };

  console.log(JSON.stringify(result, null, 2));
  if (
    corpus.cases.length < 50 ||
    overall.recall < 0.9 ||
    overall.falseTriggerRate >= 0.05 ||
    Object.values(byHost).some((metrics) => metrics.recall < 0.9 || metrics.falseTriggerRate >= 0.05) ||
    guardrail.cases.length < 40 ||
    guardrailOverall.recall < 0.9 ||
    guardrailOverall.falseTriggerRate >= 0.05 ||
    Object.values(guardrailByHost).some((metrics) => metrics.recall < 0.9 || metrics.falseTriggerRate >= 0.05) ||
    upgradeJob.cases.length < 40 ||
    upgradeOverall.recall < 0.9 ||
    upgradeOverall.falseTriggerRate >= 0.05 ||
    Object.values(upgradeByHost).some((metrics) => metrics.recall < 0.9 || metrics.falseTriggerRate >= 0.05) ||
    lifecycleFalseOnAdd.length > 0 ||
    addFalseOnLifecycle.length > 0 ||
    upgradeOnAdd.length > 0 ||
    addOnUpgrade.length > 0
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await run();
}
