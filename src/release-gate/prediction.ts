import { formatPurl, parsePurl } from "@velella/ebb/purl";
import { isIsoDate } from "@velella/ebb/registry";
import { z } from "zod";

const date = z.string().refine(isIsoDate);
const text = z.string().regex(/\S/);
const predictionSchema = z.strictObject({
  purl: z.string(),
  date,
  interval: z.strictObject({ earliest: date, latest: date }),
  confidence: z.number().min(0).max(1),
  method: text,
  sources: z
    .array(
      z
        .string()
        .regex(/^https:\/\/[^/\s?#@]+(?:[/?#][^\s]*)?$/)
        .refine((source) => URL.canParse(source)),
    )
    .min(1),
  modelVersion: text,
});

export type GatePrediction = z.infer<typeof predictionSchema>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloads(owner: Readonly<Record<string, unknown>>, format: "cyclonedx" | "spdx"): string[] {
  if (format === "cyclonedx" && Array.isArray(owner.properties)) {
    return owner.properties.flatMap((entry: unknown) =>
      object(entry) && entry.name === "offing:lifecycle:predictedEol:v1" && typeof entry.value === "string"
        ? [entry.value]
        : [],
    );
  }
  const prefix = "offing:predicted-eol:v1:";
  if (format !== "spdx" || !Array.isArray(owner.annotations)) return [];
  return owner.annotations.flatMap((entry: unknown) =>
    object(entry) &&
    entry.annotator === "Tool: offing" &&
    entry.annotationType === "OTHER" &&
    typeof entry.comment === "string" &&
    entry.comment.startsWith(prefix)
      ? [entry.comment.slice(prefix.length)]
      : [],
  );
}

export function componentPredictions(
  purl: string,
  version: string,
  owner: Readonly<Record<string, unknown>>,
  format: "cyclonedx" | "spdx",
): GatePrediction[] {
  const labelled = payloads(owner, format);
  if (labelled.length === 0) return [];
  let component: string;
  try {
    component = formatPurl({ ...parsePurl(purl), version });
  } catch {
    return [];
  }
  return labelled.flatMap((payload) => {
    try {
      const result = predictionSchema.safeParse(JSON.parse(payload));
      if (!result.success) return [];
      const prediction = result.data;
      if (
        prediction.purl !== component ||
        prediction.interval.earliest > prediction.date ||
        prediction.interval.latest < prediction.date
      )
        return [];
      return [prediction];
    } catch {
      return [];
    }
  });
}
