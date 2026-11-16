import { X509Certificate } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { join } from "node:path";

import { verifyDataBundle } from "@velella/ebb/verify";
import { build } from "esbuild";

import { checkWebSize } from "../../tools/web-size.js";

const version = "2026.11.11";
const file = `ebb-data-${version}.json`;
const url = `https://github.com/velella-sh/ebb/releases/download/data-v${version}/${file}`;
const source = "web/forecast";

async function download(address: string): Promise<ArrayBuffer> {
  const response = await fetch(address, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Ebb data download failed with HTTP ${response.status}.`);
  return response.arrayBuffer();
}

/** The P-256 Sigstore signature is DER encoded. Web Crypto expects fixed-width r and s. */
function webSignature(encoded: string): string {
  const der = Buffer.from(encoded, "base64");
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("Expected an ECDSA signature sequence.");
  const raw = Buffer.alloc(64);
  let offset = 2;
  for (const destination of [0, 32]) {
    const length = der[offset + 1] ?? 0;
    const start = offset + 2;
    if (der[offset] !== 0x02 || length < 1 || length > 33 || start + length > der.length) {
      throw new Error("Expected a P-256 signature integer.");
    }
    const integer = der.subarray(start + Math.max(0, length - 32), start + length);
    integer.copy(raw, destination + 32 - integer.length);
    offset = start + length;
  }
  if (offset !== der.length) throw new Error("Unexpected bytes after the ECDSA signature.");
  return raw.toString("base64");
}

async function getRelease() {
  const [artifact, signatureBytes] = await Promise.all([download(url), download(`${url}.sigstore.json`)]);
  const bytes = new Uint8Array(artifact);
  const signatureJson = new TextDecoder().decode(signatureBytes);
  const { bundle } = verifyDataBundle(bytes, signatureJson);
  if (bundle.manifest.version !== version) throw new Error("The signed Ebb data version does not match the release.");

  const sigstore = JSON.parse(signatureJson) as {
    verificationMaterial: { certificate: { rawBytes: string } };
    messageSignature: { signature: string };
  };
  const certificate = new X509Certificate(Buffer.from(sigstore.verificationMaterial.certificate.rawBytes, "base64"));
  if (certificate.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Expected an Ebb P-256 signing certificate.");
  }
  const publicKey = certificate.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { bytes, release: { file, publicKey, signature: webSignature(sigstore.messageSignature.signature) } };
}

async function buildPage(directory: string): Promise<void> {
  const { bytes, release } = await getRelease();
  await build({
    entryPoints: [join(source, "app.ts")],
    outfile: join(directory, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    define: { EBB_RELEASE: JSON.stringify(release) },
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
