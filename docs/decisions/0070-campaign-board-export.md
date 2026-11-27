# 0070 Campaign board export

Status: Accepted

## Context

Campaign v1 records pinned repositories and the history of their status
changes. A board can present that evidence as a site source directory and let
the operations team choose where to build and publish it.

## Decision

Export a Markdown page, configuration, SVG badge and JSON collections for
repositories, owners, the summary and batch activity. Keep those collections
independent of the rendered site. Use shipped Lateen components for tables,
textual states, activity and charts. Keep progress counts distinct from the
estimate and include its evidence timestamp and completed-batch sample size.
Read the complete versioned state and leave publishing to the operations
repository's workflow.
