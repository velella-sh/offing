import assert from "node:assert/strict";

export function assertCurrentBrand(content: string, name: string): void {
  assert.doesNotMatch(content, /\bseaworthy\b/i, `${name} uses the retired project name`);
}
