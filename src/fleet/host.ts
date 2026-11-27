export interface FleetRepository {
  readonly name: string;
  readonly defaultBranch: string | null;
  readonly archived: boolean;
  readonly fork: boolean;
  readonly disabled: boolean;
  readonly topics: readonly string[];
}

export interface FleetSelection {
  readonly patterns: readonly string[];
  includes(path: string): boolean;
}

/** Transport only. Files are read at the supplied commit into a caller-owned directory. */
export interface FleetHost {
  readonly origin: string;
  listRepositories(namespace: string): Promise<readonly FleetRepository[]>;
  readDefaultBranchHead(repository: FleetRepository): Promise<string>;
  fetchFilesAtCommit(
    repository: FleetRepository,
    commit: string,
    directory: string,
    selection: FleetSelection,
  ): Promise<number>;
}

export class FleetHostError extends Error {}
