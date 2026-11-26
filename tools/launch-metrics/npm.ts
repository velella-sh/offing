import * as z from "zod/v4";

export const NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week/@velella/offing";

const weeklyDownloads = z.object({
  package: z.literal("@velella/offing"),
  downloads: z.int().nonnegative(),
  start: z.iso.date(),
  end: z.iso.date(),
});

export async function collectNpm(fetchPublic: typeof fetch) {
  const response = await fetchPublic(NPM_DOWNLOADS);
  if (!response.ok) throw new Error(`npm downloads request returned HTTP ${response.status}.`);
  const parsed = weeklyDownloads.safeParse(await response.json());
  if (!parsed.success || parsed.data.end < parsed.data.start) {
    throw new Error("npm returned an invalid count or date range.");
  }
  const { downloads, start, end } = parsed.data;
  return { downloads, start, end };
}
