# GitHub forecast fixtures

`github.json` is a small GitHub-shaped tree with synthetic file contents and
matching blob hashes. Invalid metadata, unapproved filenames and nonregular
files must never reach the raw content host.

`http-replies.json` keeps only fields needed to replay recorded GitHub API
responses. The 404 body and 409 body were captured without credentials on
2026-11-28 from the [missing tree](https://api.github.com/repos/octocat/offing-forecast-missing-fixture-91f3ae/git/trees/HEAD?recursive=1)
and [empty tree](https://api.github.com/repos/rsc/empty/git/trees/HEAD?recursive=1).
The same 404 recording models a private repository because GitHub withholds
its existence from anonymous callers.
[GitHub REST API troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource)

The 403 status and rate headers are from a public, redacted recording of
an anonymous core API request. The replay omits the address and response
body. [Original response capture](https://github.com/pi-hole/pi-hole/issues/6691)
