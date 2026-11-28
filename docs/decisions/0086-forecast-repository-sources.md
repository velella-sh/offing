---
title: Record consented repository forecast sources
---

# 0086. Record consented repository forecast sources

The standalone browser forecast can prefill a public GitHub repository from
a URL fragment. Each lookup needs a separate user action after disclosing
its destinations and purpose. Starting a local run, editing the repository
or changing the fragment aborts any pending GitHub fetch. The page allows
connections only to its own origin and the two GitHub hosts. The module's
`publicRepositoryFetch` capability continues to carry the host's approval.

Extend the v1 records schema with a network notice, a skipped-file record
and an overflow count. Downloads with invalid UTF-8 or unsupported syntax are skipped
with a reason. Tree and transport failures, cancellation and mismatched Git blobs
stop the request. Successful parses use the same rules and record kinds as
local inputs. The result can contain only skip records for its source list
when all files were skipped. Local file and paste records retain their
previous shape.
