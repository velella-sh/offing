import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = "docs/demos/manifest.json";

const recordings = [
  {
    tape: "demos/forecast.tape",
    outputs: [
      "docs/assets/demos/forecast.gif",
      "docs/demos/forecast.gif",
      "docs/demos/forecast.mp4",
      "docs/demos/forecast.srt",
    ],
  },
  {
    tape: "demos/guard.tape",
    outputs: ["docs/demos/guard.gif", "docs/demos/guard.mp4", "docs/demos/guard.srt"],
  },
  {
    tape: "demos/guard-agent.tape",
    outputs: ["docs/demos/guard-agent.mp4", "docs/demos/guard-agent.srt"],
  },
] as const;

async function fingerprint(root: string, path: string) {
  const data = await readFile(resolve(root, path));
  return { path, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length };
}

export async function renderDemoManifest(root: string, offingVersion: string): Promise<string> {
  if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.test(offingVersion)) {
    throw new Error("Pass an exact published Offing version.");
  }
  const entries = await Promise.all(
    recordings.map(async ({ tape, outputs }) => ({
      tape: await fingerprint(root, tape),
      outputs: await Promise.all(outputs.map((output) => fingerprint(root, output))),
    })),
  );
  return (
    JSON.stringify({ schemaVersion: "offing.demo-manifest.v1", offingVersion, recordings: entries }, null, 2) + "\n"
  );
}

export async function verifyDemoManifest(root: string, expectedVersion?: string): Promise<void> {
  const tracked = await readFile(resolve(root, manifestPath), "utf8");
  const manifest: unknown = JSON.parse(tracked);
  const version =
    manifest !== null && typeof manifest === "object" && "offingVersion" in manifest
      ? manifest.offingVersion
      : undefined;
  if (typeof version !== "string" || (expectedVersion !== undefined && version !== expectedVersion)) {
    throw new Error("Demo manifest does not match the expected Offing version.");
  }
  if (tracked !== (await renderDemoManifest(root, version))) {
    throw new Error(
      "Demo manifest is stale. Check the tape and media, then regenerate the manifest with the recorded version.",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, version, ...rest] = process.argv.slice(2);
  if (command === "--write" && version && rest.length === 0) {
    await writeFile(manifestPath, await renderDemoManifest(process.cwd(), version));
  } else if (command === "--check" && rest.length === 0) {
    await verifyDemoManifest(process.cwd(), version);
    console.log("acc-demo-tapes: released tape, GIF, MP4, and caption digests match the manifest.");
  } else {
    throw new Error("Usage: demo-manifest --write <version> | --check [version]");
  }
}
