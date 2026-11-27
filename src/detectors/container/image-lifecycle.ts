import { loadDataFile } from "@velella/ebb/data-source";
import { validateRegistryV2, type RegistryV2Rule } from "@velella/ebb/registry";
import { versContains } from "@velella/ebb/vers";

import { required } from "../../required.js";
import type { ImageReference } from "./parse-image.js";

const VARIANT =
  /^(?:alpine(?:\d+(?:\.\d+)*)?|slim|bookworm|bullseye|buster|stretch|trixie|jessie|jammy|noble|focal|oracle|oraclelinux\d*|debian|ubuntu|minimal)$/;
const DEBIAN_CODENAMES = new Map<string, string>([
  ["buzz", "1.1"],
  ["rex", "1.2"],
  ["bo", "1.3"],
  ["hamm", "2.0"],
  ["slink", "2.1"],
  ["potato", "2.2"],
  ["woody", "3.0"],
  ["sarge", "3.1"],
  ["etch", "4"],
  ["lenny", "5"],
  ["squeeze", "6"],
  ["wheezy", "7"],
  ["jessie", "8"],
  ["stretch", "9"],
  ["buster", "10"],
  ["bullseye", "11"],
  ["bookworm", "12"],
  ["trixie", "13"],
  ["forky", "14"],
]);

const UBUNTU_CODENAMES = new Map<string, string>([
  ["warty", "4.10"],
  ["hoary", "5.04"],
  ["breezy", "5.10"],
  ["dapper", "6.06"],
  ["edgy", "6.10"],
  ["feisty", "7.04"],
  ["gutsy", "7.10"],
  ["hardy", "8.04"],
  ["intrepid", "8.10"],
  ["jaunty", "9.04"],
  ["karmic", "9.10"],
  ["lucid", "10.04"],
  ["maverick", "10.10"],
  ["natty", "11.04"],
  ["oneiric", "11.10"],
  ["precise", "12.04"],
  ["quantal", "12.10"],
  ["raring", "13.04"],
  ["saucy", "13.10"],
  ["trusty", "14.04"],
  ["utopic", "14.10"],
  ["vivid", "15.04"],
  ["wily", "15.10"],
  ["xenial", "16.04"],
  ["yakkety", "16.10"],
  ["zesty", "17.04"],
  ["artful", "17.10"],
  ["bionic", "18.04"],
  ["cosmic", "18.10"],
  ["disco", "19.04"],
  ["eoan", "19.10"],
  ["focal", "20.04"],
  ["groovy", "20.10"],
  ["hirsute", "21.04"],
  ["impish", "21.10"],
  ["jammy", "22.04"],
  ["kinetic", "22.10"],
  ["lunar", "23.04"],
  ["mantic", "23.10"],
  ["noble", "24.04"],
  ["oracular", "24.10"],
  ["plucky", "25.04"],
]);

/** Extra suffix parts that mcr.microsoft.com/dotnet tags carry: CPU architectures, image flavors, distros, and Windows builds. */
const DOTNET_VARIANT =
  /^(?:amd64|arm64v8|arm64|arm32v7|chiseled|extra|composite|distroless|cbl|mariner\d+(?:\.\d+)?|azurelinux\d+(?:\.\d+)?|nanoserver|windowsservercore|ltsc20\d\d|\d{4})$/;
/**
 * The .NET images Microsoft publishes on its own registry. Their tags name the .NET release line (`sdk:6.0`,
 * `aspnet:6.0-alpine`), so they are judged with the `dotnet` runtime rules instead of a copy of them (decision in
 * docs/detectors/container.md). `dotnet/core/*` is where the same images lived before .NET 5.
 */
const MICROSOFT_REGISTRY = "mcr.microsoft.com";
const DOTNET_IMAGES = new Set(
  ["sdk", "aspnet", "runtime", "runtime-deps"].flatMap((name) => [`dotnet/${name}`, `dotnet/core/${name}`]),
);
const TAG_VERSION = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/;
const UNBOUNDED = 999_999;

export function distroCodenameVersion(distro: string, codename: string): string | undefined {
  return distro === "debian"
    ? DEBIAN_CODENAMES.get(codename)
    : distro === "ubuntu"
      ? UBUNTU_CODENAMES.get(codename)
      : undefined;
}

type TagClass = { kind: "versions"; lowest: string; highest: string } | { kind: "unclassified"; reason: string };

/** Replaces a Debian or Ubuntu codename at the start of a Docker Hub tag with its release number, so `debian:buster` reads as `debian:10`. */
function resolveCodename(repository: string, tag: string): string {
  const name = required(tag.split("-")[0], "tag part");
  const release = repository.startsWith("library/")
    ? distroCodenameVersion(repository.slice("library/".length), name)
    : undefined;
  return release === undefined ? tag : tag.replace(name, release);
}

/** The versions a tag can stand for, or why it cannot be read as a release line. */
function classifyTag(tag: string | undefined, digest: string | undefined, extraVariant?: RegExp): TagClass {
  if (tag === undefined) {
    return {
      kind: "unclassified",
      reason: digest
        ? "the image is pinned by digest only, with no tag naming a release line"
        : "the image has no tag, so it follows the latest release",
    };
  }
  const match = TAG_VERSION.exec(tag);
  if (!match) return { kind: "unclassified", reason: `the tag "${tag}" does not name a release line` };
  const [, major, minor, patch, suffix] = match;
  if (
    suffix !== undefined &&
    !suffix.split("-").every((part) => VARIANT.test(part) || extraVariant?.test(part) === true)
  ) {
    return { kind: "unclassified", reason: `the tag "${tag}" has a suffix Offing does not recognize` };
  }
  const lowest = `${major}.${minor ?? "0"}.${patch ?? "0"}`;
  const highest = `${major}.${minor ?? UNBOUNDED}.${patch ?? UNBOUNDED}`;
  return { kind: "versions", lowest, highest };
}

function rulesByRepository(rules: readonly RegistryV2Rule[]): Map<string, RegistryV2Rule[]> {
  const map = new Map<string, RegistryV2Rule[]>();
  for (const rule of rules) {
    const repository = rule.purl.replace(/^pkg:docker\//, "");
    map.set(repository, [...(map.get(repository) ?? []), rule]);
  }
  return map;
}

/** The rules for a Docker Hub image, or the .NET runtime rules for a Microsoft .NET image. */
export function rulesFor(
  image: ImageReference,
  { rules, dotnetRules }: ImageRules,
): readonly RegistryV2Rule[] | undefined {
  if (image.registry === "docker.io") return rules.get(image.repository);
  if (image.registry === MICROSOFT_REGISTRY && DOTNET_IMAGES.has(image.repository)) return dotnetRules;
  return undefined;
}

export interface ImageRules {
  readonly all: readonly RegistryV2Rule[];
  readonly rules: ReadonlyMap<string, RegistryV2Rule[]>;
  readonly dotnetRules: readonly RegistryV2Rule[];
}

export async function loadImageRules(): Promise<ImageRules> {
  const all = validateRegistryV2(await loadDataFile("registry/container.json")).rules;
  const dotnet = validateRegistryV2(await loadDataFile("registry/dotnet.json")).rules;
  return {
    all,
    rules: rulesByRepository(all),
    dotnetRules: dotnet.filter((rule) => rule.purl === "pkg:generic/dotnet" && rule.id.startsWith("dotnet.runtime.")),
  };
}

export function imageLifecycle(
  image: ImageReference,
  rules: ImageRules,
): {
  rule?: RegistryV2Rule;
  reason?: string;
} {
  const candidates = rulesFor(image, rules);
  if (!candidates) return {};
  const tag = classifyTag(
    image.registry === "docker.io" && image.tag !== undefined
      ? resolveCodename(image.repository, image.tag)
      : image.tag,
    image.digest,
    image.registry === MICROSOFT_REGISTRY ? DOTNET_VARIANT : undefined,
  );
  if (tag.kind === "unclassified") return { reason: tag.reason };
  const rule = candidates.find((item) => versContains(item.vers, tag.lowest) && versContains(item.vers, tag.highest));
  if (rule) return { rule };
  if (candidates.some((item) => versContains(item.vers, tag.lowest) || versContains(item.vers, tag.highest))) {
    return {
      reason: `the tag "${image.tag}" is a floating release line that spans supported and unsupported versions`,
    };
  }
  return {};
}

const OS_REPOSITORIES = new Set(["library/debian", "library/ubuntu", "library/alpine"]);

export function lacksBaseOsData(image: ImageReference): boolean {
  return (
    image.registry === "docker.io" && image.repository.startsWith("library/") && !OS_REPOSITORIES.has(image.repository)
  );
}
