# 0088. Publish and observe approved campaign changes

Status: Accepted

Campaign planning and replay already persist purpose, scope and evidence. A
migration review must preserve the verified commit, match the selected
base pin and identify its author and proof after an interrupted host
operation.

Use explicit `campaign publish`, `refresh`, host-scoped `cancel` and
`track` operations. Publish receives one campaign-level approval containing
selected repositories and their host identity, credential variable, expected
actor and default branch. It saves an additive v1 `publication`
checkpoint before an external write, carries the proof in the request body
and stores the remote request identifier and observed checks and review.
HTTP and Git credentials are used only for their approved destinations.
Local replay captures a bounded redacted bundle before publication. Both the
CLI and MCP status surface the same saved records.

Use the same canonical host and identity rules as Fleet for GitHub and
GitLab. Use an empty Git ref lease to assert that a destination branch is
absent. Keep external merge decisions with the forge and its reviewers. The
campaign's saved author, head and body checksum bind cancellation and
reconciliation to the owned request.

Use a separate credential for an operations issue in an approved private
repository. Reuse the bounded GitHub tracking issue lookup with a marker
derived from the campaign ID and the expected author. Keep operation
credentials and permission files outside the v1 state record.
