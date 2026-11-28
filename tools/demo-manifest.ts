import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { checkDemoCaptions, writeDemoCaptions } from "./demo-captions.js";

export const demoManifestPath = "docs/demos/manifest.json";

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

export const captionFiles = recordings.flatMap(({ tape, outputs }) =>
  outputs.filter((output) => output.endsWith(".srt")).map((output) => ({ tape, output })),
);

const mediaDirectories = ["docs/demos", "docs/assets/demos"];
const metadataFiles = new Set([demoManifestPath, "docs/demos/README.md", "docs/assets/demos/.gitkeep"]);
const supplemental = [
  ...(
    [
      ["baseline", "67505f0cabcea7f4148c62bbc2ac0f9d91bcaab4103595e1c915f7ba69353701"],
      ["check", "1fde97808a806e75cec33f682b5d2a02adf23a83ea6e5b8f0f24394e3b3c2e92"],
      ["explain", "50d49b22d346e344fded0c8741a7ffe3170fd47fceaf5c29595c1484ddb2df97"],
      ["fix", "147037a040513c4a83f06a41525ede87595acf0cb1b07b1433dd22671515e8f2"],
      ["lookup", "8907c5899743933cfabff725b2a6d7f0e9375cb303d483a3ae84d3aaee958bd7"],
      ["scan", "81c3c49088b61ce40585c9979179a9b5aecee5501e2ccd4f8fe2a0f58e168e42"],
      ["setup", "49efa7e431f5ef2c49a85ef9e76a56123023e629d0fb012874bd78af426dfbde"],
    ] as const
  ).map(([name, sha256]) => ({
    path: `docs/assets/demos/${name}.gif`,
    sha256,
    kind: "historical",
    sourceRevision: "08709fe36c752c64a3310599a1ea913dbc4a158b",
  })),
  {
    path: "docs/assets/demos/autopilot.gif",
    sha256: "345fc2743b75247ca0328d6587f8f4413e7b28ba972f90c8bd4dc2696f5bddda",
    kind: "candidate",
    sourceRevision: "b821f1ce170475aea318e7e72dc93a1c1af700ee",
  },
  {
    path: "docs/demos/first-run.gif",
    sha256: "b727d22b172fcc855ac1b12afa6d339066a267c32904541b9b38c48d07eb47f0",
    kind: "candidate",
    sourceRevision: "f3fbf8cab61fe772c28ab8440fe4cbe484ce8a2d",
  },
];

const mediaPaths = new Set([...recordings.flatMap(({ outputs }) => outputs), ...supplemental.map(({ path }) => path)]);
const fileEntry = z.object({ path: z.string(), sha256: z.string(), bytes: z.number() });
const manifestSchema = z.object({
  schemaVersion: z.literal("offing.demo-manifest.v1"),
  offingVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/u),
  recordings: z.array(z.object({ tape: fileEntry, outputs: z.array(fileEntry) })),
  supplemental: z.array(fileEntry.extend({ kind: z.string(), sourceRevision: z.string() })),
});

export class DemoManifestError extends Error {
  constructor(
    message: string,
    readonly paths: string[],
    readonly unavailable = false,
  ) {
    super(message);
  }
}

async function validateInventory(root: string): Promise<void> {
  const listed = new Set<string>();
  for (const folder of mediaDirectories) {
    const directory = resolve(root, folder);
    const entries = await readdir(directory, { withFileTypes: true, recursive: true }).catch(() => {
      throw new DemoManifestError(`Demo directory is missing or unreadable: ${folder}.`, [folder]);
    });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join("/");
      if (!metadataFiles.has(path)) listed.add(path);
    }
  }
  const untracked = [...listed].filter((path) => !mediaPaths.has(path)).sort();
  const missing = [...mediaPaths].filter((path) => !listed.has(path)).sort();
  if (untracked.length || missing.length) {
    const details = [
      untracked.length ? `Untracked demo media: ${untracked.join(", ")}.` : "",
      missing.length ? `Missing demo media: ${missing.join(", ")}.` : "",
    ].filter(Boolean);
    throw new DemoManifestError(details.join(" "), [...untracked, ...missing]);
  }
}

async function fingerprint(root: string, path: string) {
  const absolute = resolve(root, path);
  const unreadable = () =>
    new DemoManifestError(`Demo file is missing, unreadable or not a regular file: ${path}.`, [path]);
  const info = await lstat(absolute).catch(() => undefined);
  if (!info?.isFile()) throw unreadable();
  if (path.endsWith(".gif") && info.size >= 3_000_000) {
    throw new DemoManifestError(`Demo GIF must be smaller than 3 MB: ${path} (${info.size} bytes).`, [path]);
  }
  const data = await readFile(absolute).catch(() => {
    throw unreadable();
  });
  return { path, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length };
}

async function captureSupplemental(root: string) {
  return Promise.all(
    supplemental.map(async ({ path, sha256, ...provenance }) => {
      const observed = await fingerprint(root, path);
      if (observed.sha256 !== sha256) {
        throw new DemoManifestError(`Supplemental media differs from its recorded source: ${path}.`, [path]);
      }
      return { ...observed, ...provenance };
    }),
  );
}

async function captureDemoManifest(root: string, offingVersion: string) {
  if (!manifestSchema.shape.offingVersion.safeParse(offingVersion).success) {
    throw new Error("Pass an exact published Offing version.");
  }
  root = resolve(root);
  await validateInventory(root);
  return {
    schemaVersion: "offing.demo-manifest.v1" as const,
    offingVersion,
    recordings: await Promise.all(
      recordings.map(async ({ tape, outputs }) => ({
        tape: await fingerprint(root, tape),
        outputs: await Promise.all(outputs.map((output) => fingerprint(root, output))),
      })),
    ),
    supplemental: await captureSupplemental(root),
  };
}

function serialize(manifest: z.infer<typeof manifestSchema>): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

export async function renderDemoManifest(root: string, offingVersion: string): Promise<string> {
  return serialize(await captureDemoManifest(root, offingVersion));
}

function manifestFiles(manifest: z.infer<typeof manifestSchema>) {
  return [...manifest.recordings.flatMap(({ tape, outputs }) => [tape, ...outputs]), ...manifest.supplemental];
}

function staleArtifacts(tracked: z.infer<typeof manifestSchema>, actual: z.infer<typeof manifestSchema>): string[] {
  const previous = new Map(manifestFiles(tracked).map((entry) => [entry.path, JSON.stringify(entry)]));
  const current = new Map(manifestFiles(actual).map((entry) => [entry.path, JSON.stringify(entry)]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((path) => mediaPaths.has(path) || recordings.some(({ tape }) => tape === path))
    .filter((path) => previous.get(path) !== current.get(path))
    .sort();
}

export async function verifyDemoManifest(root: string, expectedVersion?: string) {
  const tracked = await readFile(resolve(root, demoManifestPath), "utf8").catch(() => "");
  const parsed = manifestSchema.safeParse(parseManifest(tracked));
  if (!parsed.success) throw new DemoManifestError("No readable release demo manifest.", [demoManifestPath], true);
  const { offingVersion: version } = parsed.data;
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new DemoManifestError(
      `Demo manifest does not match the expected Offing version: recorded ${version}, expected ${expectedVersion}.`,
      recordings.map(({ tape }) => tape),
    );
  }
  const actual = await captureDemoManifest(root, version);
  if (tracked !== serialize(actual)) {
    const paths = staleArtifacts(parsed.data, actual);
    const detail = paths.length ? ` Changed files: ${paths.join(", ")}.` : "";
    throw new DemoManifestError(`Demo manifest is stale.${detail}`, paths.length ? paths : [demoManifestPath]);
  }
  return { recordings: actual.recordings.length, outputs: actual.recordings.flatMap(({ outputs }) => outputs).length };
}

function parseManifest(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, version, ...rest] = process.argv.slice(2);
  if (command === "--write" && version && rest.length === 0) {
    await writeFile(demoManifestPath, await renderDemoManifest(process.cwd(), version));
  } else if (command === "--check" && rest.length === 0) {
    await verifyDemoManifest(process.cwd(), version);
    console.log("acc-demo-tapes: released tape, GIF, MP4, and caption digests match the manifest.");
  } else if (command === "--write-captions" && version === undefined) {
    await writeDemoCaptions(process.cwd(), captionFiles);
  } else if (command === "--check-captions" && version === undefined) {
    await checkDemoCaptions(process.cwd(), captionFiles);
    console.log("acc-demo-tapes: caption text and timestamps match the annotated tapes.");
  } else {
    throw new Error("Usage: demo-manifest --write <version> | --check [version] | --write-captions | --check-captions");
  }
}
