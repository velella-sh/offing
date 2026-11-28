import type { ForecastToolContext, ForecastToolInput, ForecastToolResult } from "./forecast-tool-types.js";
import { forecastDataRelease } from "./forecast-tool/data.js";
import { maxInputBytes as inputBudget, runForecastTool } from "./forecast-tool/records.js";

export type {
  ForecastRecords,
  ForecastToolContext,
  ForecastToolInput,
  ForecastToolResult,
} from "./forecast-tool-types.js";

/** Version of Offing's local forecast module interface. */
export const contractVersion = 1;
/** Identify Offing's forecast module to a tool host. */
export const name = "offing-forecast";
/** List the supported input kinds in their display order. */
export const inputs = ["file", "paste", "url"] as const;
/** Cap the aggregate size of selected inputs, in UTF-8 bytes. */
export const maxInputBytes: number = inputBudget;
/** Identify the JSON Schema for a populated forecast record list. */
export const recordsSchema = "https://velella.sh/offing/schemas/forecast-records.v1.schema.json";

/** Forecast using Offing's pinned Ebb release and the current UTC day. */
export function run(input: ForecastToolInput, context: ForecastToolContext): Promise<ForecastToolResult> {
  return runForecastTool(input, context, forecastDataRelease, new Date().toISOString().slice(0, 10));
}
