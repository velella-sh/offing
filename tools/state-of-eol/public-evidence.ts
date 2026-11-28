import { redactLine } from "../../src/report-issue.js";
import type { StudyCapture } from "./capture.js";
import type { StudyLineage } from "./lineage.js";

const token = /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,})\b/g;
const publicText = (value: string): string => redactLine(value.replace(token, "<redacted>"), "<local-capture-root>");

/** Keep attributed observations and graph evidence. Dockerfile instructions and other source excerpts are unnecessary. */
export function publicStudyCapture(capture: StudyCapture): StudyCapture {
  const lineage = capture.lineage;
  return {
    ...capture,
    upgrade: capture.upgrade.map((result) =>
      result.status === "failed"
        ? result
        : {
            ...result,
            report: {
              ...result.report,
              issues: result.report.issues.map((issue) => ({
                ...issue,
                reason: publicText(issue.reason),
                evidence: { ...issue.evidence, value: publicText(issue.evidence.value) },
              })),
            },
          },
    ),
    lineage: lineage
      ? {
          ...lineage,
          documents: lineage.documents.map((document) => ({
            ...document,
            declarations: [],
            stages: document.stages.map((stage) => ({
              ...stage,
              reference: publicText(stage.reference),
              resolved: publicText(stage.resolved),
              copies: stage.copies.map((copy) => ({ ...copy, reference: publicText(copy.reference) })),
            })),
          })),
        }
      : null,
  };
}

export function publicStudyLineage(lineage: StudyLineage): StudyLineage {
  return {
    ...lineage,
    chains: lineage.chains.map((chain) => ({
      ...chain,
      image: publicText(chain.image),
      links: chain.links.map((link) => ({
        ...link,
        reference: publicText(link.reference),
        ...(link.resolvedReference === undefined ? {} : { resolvedReference: publicText(link.resolvedReference) }),
        ...(link.reason === undefined ? {} : { reason: publicText(link.reason) }),
      })),
    })),
  };
}
