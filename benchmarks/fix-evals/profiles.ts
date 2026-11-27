export const profiles = {
  npm: {
    image: "docker.io/library/node@sha256:e0e989b967dacc279681ed81774b2ce9eeebbb0efb8e0c427573235bebf1eda1",
    build: ["sh", "-ec", "npm ci --offline --cache .npm-cache --no-audit --no-fund && npm run build"],
    test: ["sh", "-ec", "npm ci --offline --cache .npm-cache --no-audit --no-fund && npm test"],
  },
  python: {
    image: "docker.io/library/python@sha256:65e09d48d9005cdb8d1bde2e56462817859655bc06b8828d60bed4cfbbaf76d1",
    build: ["python", "-m", "compileall", "-q", "."],
    test: ["python", "-m", "unittest", "discover"],
  },
  go: {
    image: "docker.io/library/golang@sha256:66c04b389c4b0a2e0f0d51f3a37de0109650887a321b2a3b8cd9f573d7490a01",
    build: ["go", "build", "-mod=vendor", "./..."],
    test: ["go", "test", "-mod=vendor", "./..."],
  },
  java: {
    image: "docker.io/library/maven@sha256:80034909d9a9f0b89d3d2c583f07f3b7650309bc4e6b886ad5b860b9e1bfa439",
    build: [
      "mvn",
      "--offline",
      "--batch-mode",
      "-Dmaven.repo.local=/work/tree/.m2/repository",
      "-DskipTests",
      "package",
    ],
    test: ["mvn", "--offline", "--batch-mode", "-Dmaven.repo.local=/work/tree/.m2/repository", "test"],
  },
  terraform: {
    image: "docker.io/hashicorp/terraform@sha256:593ec1064a1ecec0290938e1231d4c1e0950536a75bd1d07159e60aff9945ea5",
    build: ["terraform", "validate", "-no-color"],
  },
  kubernetes: {
    image: "docker.io/library/node@sha256:e0e989b967dacc279681ed81774b2ce9eeebbb0efb8e0c427573235bebf1eda1",
    build: [
      "/usr/local/bin/kubeconform",
      "-strict",
      "-summary",
      "-schema-location",
      "./schemas/{{.ResourceKind}}{{.KindSuffix}}.json",
      "./manifests",
    ],
  },
  "github-actions": {
    image: "docker.io/rhysd/actionlint@sha256:9d36088643581e728c969f35141f88139fec77280b2be23c1f66f8e40e1025e7",
    build: [
      "sh",
      "-ec",
      'set -- .github/workflows/*.yml .github/workflows/*.yaml; for f do if [ -f "$f" ]; then set -- "$@" "$f"; fi; shift; done; [ "$#" -gt 0 ]; actionlint "$@"',
    ],
  },
} as const satisfies Record<
  string,
  { image: string; build: readonly [string, ...string[]]; test?: readonly [string, ...string[]] }
>;

export type Profile = keyof typeof profiles;

export function isProfile(name: string): name is Profile {
  return Object.hasOwn(profiles, name);
}
