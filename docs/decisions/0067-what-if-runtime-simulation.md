# 0067. Publish a read-only runtime simulation result

Status: accepted

`offing forecast --target` and MCP `simulate_upgrade` return
`offing.whatif.v1`. Repository simulations reuse the upgrade analyzers and
recorded lifecycle ranges. They replace only provable literal pins in the
projection. They never solve package versions, execute project commands, or
modify a checkout. Existing forecast and upgrade reports keep their shapes.

An opt-in fleet scan attaches compact compatibility evidence to each pinned
repository row in `offing.fleet.v1`. The offline simulation uses that evidence
only for the same target and date. Aggregate-only recordings remain valid
and return unknown for all repositories.

See [the versioned contract](../spec/what-if/v1.md).
