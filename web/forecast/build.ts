import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join } from "node:path";

import { verifyDataBundle } from "@velella/ebb/verify";
import { build } from "esbuild";

import { forecastDataRelease, verifyBundle } from "../../src/forecast-tool/data.js";
import { checkWebSize } from "../../tools/web-size.js";

const { version, file } = forecastDataRelease;
const url = `https://github.com/velella-sh/ebb/releases/download/data-v${version}/${file}`;
const source = "web/forecast";

async function download(address: string): Promise<ArrayBuffer> {
  const response = await fetch(address, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Ebb data download failed with HTTP ${response.status}.`);
  return response.arrayBuffer();
}

async function getRelease(): Promise<Uint8Array> {
  const [artifact, signature] = await Promise.all([download(url), download(`${url}.sigstore.json`)]);
  const bytes = new Uint8Array(artifact);
  const { bundle } = verifyDataBundle(bytes, new TextDecoder().decode(signature));
  if (bundle.manifest.version !== version) throw new Error("The signed Ebb data version does not match the release.");
  await verifyBundle(bytes, forecastDataRelease);
  return bytes;
}

async function buildPage(directory: string): Promise<void> {
  const bytes = await getRelease();
  await build({
    entryPoints: [join(source, "app.ts")],
    outfile: join(directory, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    plugins: [
      {
        name: "no-node-builtins",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, ({ path }) =>
            isBuiltin(path) || path.startsWith("node:")
              ? { errors: [{ text: `Node import in forecast web: ${path}` }] }
              : undefined,
          );
        },
      },
    ],
  });
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, file), bytes),
    ...["index.html", "style.css"].map((asset) => copyFile(join(source, asset), join(directory, asset))),
  ]);
  await checkWebSize(directory);
}

await buildPage(process.argv[2] ?? "dist/forecast-web");
