# 0077 Build proof v1 from a recorded Autopilot run

Status: Accepted

## Context

The Autopilot state record identifies a checkout and ordered phases. The test runner, verification comparison, and agent drivers produce their own records. Proof consumers need one way to publish those records together and determine which commands actually ran.

## Decision

Export `prepareAutopilotProofPublication` from `@velella/offing/proof`. It accepts a terminal Autopilot record plus its companion scan comparison, test runs, agent runs, budget, tool versions, and full UTF-8 logs. The producer replays the recorded transitions, matches agent runs to their phase visits, and checks both scan identities against a local Git range. The base must be an ancestor of the head. In a stopped run the two commits may be the same.

Link each tested command to a specific test record by index and match its literal argv. The final attempt supplies its status and actual exit code. A failed or timed-out attempt has a failed command status. A timeout retains a null exit code, and a JUnit failure can retain exit code zero. An explicit skipped link has null evidence fields. Unlinked planned commands remain not run.

A completed run requires passing verification and at least one linked passing test. A stopped run can be published with a checkout and scan identities even if testing never began.

The command log contains `[stdout]` followed by a newline, the exact stdout text, a newline, `[stderr]` followed by a newline, and the exact stderr text. Redact before publishing any bytes and hash the published text for `logSha256`. The two individual stream attachments remain independently verifiable. The existing v1 schemas and the existing publication helper remain available.
