export const INPUT_PATH = "benchmarks/comparison/herodevs/sbom-capture.json";
export const CLAIMS_PATH = "benchmarks/comparison/herodevs/claims.json";
export const RESULT_DIR = "benchmarks/comparison/herodevs";

export interface DatedClaim {
  purl: string;
  major: number;
  eol: string;
  publishedAt: string | null;
  source: string;
}

export interface ClaimsSnapshot {
  checkedAt: string;
  claims: DatedClaim[];
}

export interface OffingDate {
  purl: string;
  ruleId: string;
  eol: string;
  source: string;
}

export interface SbomCase {
  repository: string;
  commit: string;
  packages: string[];
  excluded: number;
  offing: OffingDate[];
}

export interface SbomCapture {
  offingVersion: string;
  offingCommit: string;
  dataVersion: string;
  syftVersion: string;
  cases: SbomCase[];
}
