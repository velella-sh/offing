import { verifyBundle, type ForecastData, type ForecastSignature } from "../../src/forecast-tool/data.js";

declare const EBB_RELEASE: ForecastSignature & { file: string };

async function fetchData(): Promise<ForecastData> {
  const url = new URL(EBB_RELEASE.file, import.meta.url);
  const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("The Ebb data could not be loaded. Try again in a moment.");
  return verifyBundle(await response.arrayBuffer(), EBB_RELEASE);
}

let data: Promise<ForecastData> | undefined;

export function loadData(): Promise<ForecastData> {
  data ??= fetchData().catch((error: unknown) => {
    data = undefined;
    throw error;
  });
  return data;
}
