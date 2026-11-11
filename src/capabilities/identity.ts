/**
 * The manifest fields that every Offing release shares. Ecosystem, capability, and surface
 * items live one per file next to this one, so adding an item never edits a shared list.
 */
export const manifestIdentity = {
  schemaVersion: "offing.capabilities.v1",
  manifestVersion: "1.9.0",
  product: {
    name: "Offing",
    package: "@velella/offing",
  },
  compatibility: {
    node: ">=22",
    schemaMajor: 1,
    unknownFields: "ignore",
    unknownCapabilityIds: "ignore",
    unknownSurfaceIds: "ignore",
    unlistedCapabilities: "unsupported",
    unlistedEcosystems: "unsupported",
    unknownSchemaMajor: "reject",
  },
} as const;
