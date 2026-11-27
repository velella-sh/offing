import { LineCounter, isMap, isScalar, isSeq, parseAllDocuments, stringify, visit } from "yaml";
import type { YAMLMap } from "yaml";

import { MAXIMUM_DOCUMENTS, MAXIMUM_INPUT_BYTES } from "../../../detectors/kubernetes/parse-manifest.js";
import type { Edit } from "./edits.js";

export interface StructuralApi {
  kind: string;
  from: string;
  to: string;
}

const WORKLOADS = new Set(["Deployment", "DaemonSet", "ReplicaSet", "StatefulSet"]);
const APPS_BETA = new Set(["extensions/v1beta1", "apps/v1beta1", "apps/v1beta2"]);

export function structuralApi(from: string, kind: string): StructuralApi | undefined {
  if (WORKLOADS.has(kind) && APPS_BETA.has(from)) return { kind, from, to: "apps/v1" };
  if (kind === "HorizontalPodAutoscaler" && /^autoscaling\/v2beta[12]$/.test(from))
    return { kind, from, to: "autoscaling/v2" };
  if (kind === "PodDisruptionBudget" && from === "policy/v1beta1") return { kind, from, to: "policy/v1" };
  return undefined;
}

interface Resource {
  map: YAMLMap;
  anchored: boolean;
}

export interface Manifest {
  text: string;
  lines: LineCounter;
  resources: Map<number, Resource>;
}

function collect(resources: Map<number, Resource>, lines: LineCounter, map: YAMLMap, anchored: boolean, depth = 0) {
  if (depth > 10) return;
  const version = map.get("apiVersion", true);
  if (isScalar(version) && version.range) resources.set(lines.linePos(version.range[0]).line, { map, anchored });
  const items = map.get("items", true);
  if (map.get("kind") === "List" && isSeq(items)) {
    for (const item of items.items) if (isMap(item)) collect(resources, lines, item, anchored, depth + 1);
  }
}

export function readManifest(text: string): Manifest {
  const lines = new LineCounter();
  const resources = new Map<number, Resource>();
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_INPUT_BYTES) return { text, lines, resources };
  const documents = parseAllDocuments(text, { lineCounter: lines, merge: false, prettyErrors: false });
  if (documents.length > MAXIMUM_DOCUMENTS || documents.some(({ errors }) => errors.length > 0))
    return { text, lines, resources };
  for (const { contents } of documents) {
    if (!isMap(contents)) continue;
    let anchored = false;
    visit(contents, {
      Alias() {
        anchored = true;
        return visit.BREAK;
      },
      Node(_key, node) {
        if (node.anchor !== undefined) {
          anchored = true;
          return visit.BREAK;
        }
      },
    });
    collect(resources, lines, contents, anchored);
  }
  return { text, lines, resources };
}

/** Make structural edits only against the resource named by the detector, never against a sibling in the same file. */
export function structuralEdits(manifest: Manifest, line: number, api: StructuralApi): Edit[] | string {
  const resource = manifest.resources.get(line);
  if (resource?.map.get("kind") !== api.kind || resource.map.get("apiVersion") !== api.from)
    return "The Kubernetes resource at the finding no longer matches the parsed API version and kind.";
  if (resource.anchored) return "The Kubernetes resource uses a YAML anchor or alias.";
  const spec = resource.map.get("spec", true);
  if (!isMap(spec)) return "The Kubernetes resource does not declare a literal spec mapping.";
  if (api.kind === "PodDisruptionBudget") return disruptionBudgetEdits(spec);
  if (api.kind === "HorizontalPodAutoscaler") return autoscalerEdits(manifest, spec, api.from);
  return workloadEdits(manifest, spec, api.kind);
}

function nonEmptySelector(selector: unknown): boolean {
  if (!isMap(selector)) return false;
  const labels = selector.get("matchLabels", true);
  const expressions = selector.get("matchExpressions", true);
  return (isMap(labels) && labels.items.length > 0) || (isSeq(expressions) && expressions.items.length > 0);
}

function disruptionBudgetEdits(spec: YAMLMap): Edit[] | string {
  if (!spec.has("selector") || nonEmptySelector(spec.get("selector", true))) return [];
  return "An empty or ambiguous PodDisruptionBudget selector can select every pod in policy/v1. Review the migration packet.";
}

function workloadEdits(manifest: Manifest, spec: YAMLMap, kind: string): Edit[] | string {
  if (spec.has("rollbackTo") || spec.has("templateGeneration"))
    return "The workload contains fields removed from apps/v1. Review the migration packet.";
  if (spec.has("selector"))
    return nonEmptySelector(spec.get("selector", true)) ? [] : "The workload selector is empty or ambiguous.";
  const template = spec.get("template", true);
  const metadata = isMap(template) ? template.get("metadata", true) : undefined;
  const labels = isMap(metadata) ? metadata.get("labels", true) : undefined;
  if (
    !isMap(labels) ||
    labels.items.length === 0 ||
    labels.items.some(
      ({ key, value }) =>
        !isScalar(key) || !isScalar(value) || typeof key.value !== "string" || typeof value.value !== "string",
    )
  )
    return `The ${kind} pod template labels are not a plain, non-empty string map.`;
  const first = spec.items[0]?.key;
  if (!isScalar(first) || !first.range || spec.flow) return "The workload spec is not a block mapping.";
  const labelValues: unknown = labels.toJSON();
  const offset = first.range[0];
  const indent = " ".repeat(manifest.lines.linePos(offset).col - 1);
  const eol = manifest.text.includes("\r\n") ? "\r\n" : "\n";
  const addition = stringify({ selector: { matchLabels: labelValues } })
    .split("\n")
    .join(eol + indent);
  return [{ start: offset, end: offset, replacement: addition }];
}

const TARGET_FIELDS = {
  targetAverageUtilization: ["Utilization", "averageUtilization"],
  targetAverageValue: ["AverageValue", "averageValue"],
} as const;

function autoscalerEdits(manifest: Manifest, spec: YAMLMap, from: string): Edit[] | string {
  if (from === "autoscaling/v2beta2" || !spec.has("metrics")) return [];
  const metrics = spec.get("metrics", true);
  if (!isSeq(metrics)) return "The HorizontalPodAutoscaler metrics are not a literal list.";
  const edits: Edit[] = [];
  for (const metric of metrics.items) {
    const edit = autoscalerMetricEdit(manifest, metric);
    if (typeof edit === "string") return edit;
    edits.push(edit);
  }
  return edits;
}

function autoscalerMetricEdit(manifest: Manifest, metric: unknown): Edit | string {
  const unsupported =
    "The v2beta1 metric requires a custom or ambiguous target migration. Review the migration packet.";
  const resource = resourceMetric(metric);
  if (!resource || resource.flow || resource.has("target")) return unsupported;
  const targets = Object.entries(TARGET_FIELDS).filter(([field]) => resource.has(field));
  const pair = targetPair(resource, targets.length === 1 ? targets[0]?.[0] : undefined);
  const target = targets[0]?.[1];
  return pair && target ? (metricTargetEdit(manifest, pair.key, pair.value, target) ?? unsupported) : unsupported;
}

function resourceMetric(metric: unknown): YAMLMap | undefined {
  if (!isMap(metric)) return undefined;
  const type = metric.get("type");
  const key = type === "Resource" ? "resource" : type === "ContainerResource" ? "containerResource" : undefined;
  const resource = key ? metric.get(key, true) : undefined;
  return isMap(resource) ? resource : undefined;
}

function targetPair(resource: YAMLMap, field: string | undefined) {
  if (!field) return undefined;
  const pair = resource.items.find(({ key }) => isScalar(key) && key.value === field);
  if (!pair || !isScalar(pair.key) || !isScalar(pair.value) || !pair.key.range || !pair.value.range) return undefined;
  return { key: pair.key.range[0], value: pair.value.range };
}

function metricTargetEdit(
  manifest: Manifest,
  start: number,
  value: readonly number[],
  [type, field]: readonly [string, string],
): Edit | undefined {
  const [valueStart, end] = value;
  if (valueStart === undefined || end === undefined) return undefined;
  const { line, col } = manifest.lines.linePos(start);
  if (manifest.lines.linePos(end).line !== line) return undefined;
  const raw = manifest.text.slice(valueStart, end);
  if (!/^(?:[0-9]+|[0-9]+(?:\.[0-9]+)?[a-zA-Z]+|"[^"\r\n]+"|'[^'\r\n]+')$/.test(raw)) return undefined;
  if (type === "Utilization" && !/^[0-9]+$/.test(raw)) return undefined;
  const indent = " ".repeat(col + 1);
  const eol = manifest.text.includes("\r\n") ? "\r\n" : "\n";
  return { start, end, replacement: `target:${eol}${indent}type: ${type}${eol}${indent}${field}: ${raw}` };
}
