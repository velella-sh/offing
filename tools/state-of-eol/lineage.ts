import { imageLifecycle, loadImageRules } from "../../src/detectors/container/image-lifecycle.js";
import { parseImageReference } from "../../src/detectors/container/parse-image.js";
import { buildImageLineage, type ImageChain } from "../../src/lineage/index.js";
import type { LineageDocument } from "../../src/lineage/inputs.js";
import { datedSupport, type Measured } from "./metrics.js";

type Rules = Awaited<ReturnType<typeof loadImageRules>>;
const key = (repository: string, path: string) => JSON.stringify([repository, path]);

function hasDirectEnd(document: LineageDocument, rules: Rules, asOf: string): boolean {
  return document.stages.some((stage) => {
    if (stage.parent !== undefined) return false;
    const image = parseImageReference(stage.resolved);
    if (!image) return false;
    const { rule } = imageLifecycle(image, rules);
    const date = rule ? datedSupport(rule) : undefined;
    return date !== undefined && date <= asOf;
  });
}

export function chainCoverage(chain: ImageChain, asOf: string) {
  const ancestry = new Set<number>();
  const ended: number[] = [];
  let noData = false;
  let unknown = chain.truncated === true;
  for (const [index, link] of chain.links.entries()) {
    if (
      link.relationship === "copy" ||
      (link.parents.length > 0 && !link.parents.some((parent) => ancestry.has(parent)))
    )
      continue;
    ancestry.add(index);
    if (link.status === "no-data" || link.baseOs === "no-data") noData = true;
    if (link.status === "unknown" || link.tagLookupIncomplete) unknown = true;
    const date = datedSupport({ event: link.status, deadline: link.deadline ?? null });
    if (date !== undefined && date <= asOf && link.ruleId) ended.push(index);
  }
  return { noData, unknown, ended };
}

export async function resolveStudyLineage(rows: readonly Measured[], asOf: string) {
  const inputs = rows.flatMap(({ capture }) => (capture.lineage ? [capture.lineage] : []));
  const rules = await loadImageRules();
  const files = inputs.flatMap(({ repository, documents }) =>
    documents
      .filter(({ kind }) => kind === "dockerfile")
      .map((document) => ({
        repository: repository.name,
        path: document.path,
        direct: hasDirectEnd(document, rules, asOf),
        stageCount: document.stages.length,
      })),
  );
  const pinnedFiles = new Set(files.map(({ repository, path }) => key(repository, path)));
  const chains = buildImageLineage(inputs, rules).chains.filter(
    ({ repository, path }) => repository !== undefined && pinnedFiles.has(key(repository, path)),
  );
  return { files, chains };
}

export type StudyLineage = Awaited<ReturnType<typeof resolveStudyLineage>>;

export function imageBreakdown(evidence: StudyLineage, unavailableRepositories: number, asOf: string) {
  const files = new Map(
    evidence.files.map(({ repository, path, direct, stageCount }) => [
      key(repository, path),
      {
        direct,
        noData: false,
        unknown: stageCount === 0,
      },
    ]),
  );
  const only = new Map<string, { chain: ImageChain; endedLinks: number[] }>();
  for (const chain of evidence.chains) {
    if (!chain.repository) continue;
    const id = key(chain.repository, chain.path);
    const file = files.get(id);
    if (!file) continue;
    const coverage = chainCoverage(chain, asOf);
    file.noData ||= coverage.noData;
    file.unknown ||= coverage.unknown;
    if (!file.direct && coverage.ended.length > 0 && !only.has(id)) {
      only.set(id, { chain, endedLinks: coverage.ended });
    }
  }
  return {
    denominator: files.size,
    lineageOnly: only.size,
    noData: [...files.values()].filter(({ noData }) => noData).length,
    unknown: [...files.values()].filter(({ unknown }) => unknown).length,
    unavailableRepositories,
    evidence: [...only.values()],
  };
}
