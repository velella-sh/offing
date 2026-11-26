# 0043 — Give config validation a versioned result

Status: proposed. Issue #350.

`offing config validate --json` emits `offing.config-validation.v1` for valid and invalid config. Each diagnostic
carries a stable code and severity, a file, one-based line and column, a JSON Pointer, and a human-readable
message and suggestion. Exit code 2 identifies an invalid or unreadable config. Deprecations are warnings.
The doctor result adds a `config` check when a config is present and uses the same diagnostics in its details.

Config v1 now reflects the runtime's handling of null aliases as unset, and single string values are equivalent
to one-element arrays for all baseline spellings. The schema rejects blank strings where the runtime already
rejected them. The runtime now rejects non-string `$schema` values and validates shadowed aliases too, matching
the editor contract. Valid aliases retain their precedence. The two legacy ignore spellings stay supported
with a deprecation annotation and a migration hint to use `ignore`.
