import { loadForecastData, type ForecastData } from "../../src/forecast-tool/data.js";

async function fetchData(file: string): Promise<Uint8Array> {
  const url = new URL(file, import.meta.url);
  const response = await fetch(url, { credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("The Ebb data could not be loaded. Try again in a moment.");
  return new Uint8Array(await response.arrayBuffer());
}

let data: Promise<ForecastData> | undefined;

export function loadData(): Promise<ForecastData> {
  data ??= loadForecastData(fetchData).catch((error: unknown) => {
    data = undefined;
    throw error;
  });
  return data;
}
