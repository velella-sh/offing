import { lstat } from "node:fs/promises";
import { posix, resolve } from "node:path";

import { DemoManifestError, demoManifestPath, verifyDemoManifest } from "../demo-manifest.js";
import { releaseUrl, repository } from "./evidence.js";

type Release = { version: string; url: string };

async function sourceLink(root: string, commit: string, path: string): Promise<string> {
  const file = await lstat(resolve(root, path)).then(
    (info) => info.isFile(),
    () => false,
  );
  const directory = mediaTree(path);
  const location = (file ? path : directory).split("/").map(encodeURIComponent).join("/");
  return `${repository}/${file ? "blob" : "tree"}/${commit}/${location}`;
}

function mediaTree(path: string): string {
  for (const directory of ["docs/assets/demos", "docs/demos", "demos"]) {
    if (path === directory || path.startsWith(directory + "/")) return directory;
  }
  return posix.dirname(path);
}

export async function readReleaseDemos(root: string, commit: string, release?: Release) {
  const manifest = await sourceLink(root, commit, demoManifestPath);
  const evidence = [manifest, release?.url ?? releaseUrl];
  if (!release) return { status: "amber", observed: "Published demo version unavailable", evidence } as const;
  try {
    const verified = await verifyDemoManifest(root, release.version);
    return {
      status: "green",
      observed: `v${release.version} · ${verified.recordings} released recordings and ${verified.outputs} output files verified`,
      evidence,
    } as const;
  } catch (error) {
    if (!(error instanceof DemoManifestError)) throw error;
    const sources = await Promise.all(error.paths.map((path) => sourceLink(root, commit, path)));
    return {
      status: error.unavailable ? ("amber" as const) : ("red" as const),
      observed: error.message,
      evidence: [...new Set([...evidence, ...sources])],
    };
  }
}
