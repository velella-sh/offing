# fish completion for offing. Save it as ~/.config/fish/completions/offing.fish, or: offing completions fish | source
complete -c offing -f
complete -c offing -n __fish_use_subcommand -a scan
complete -c offing -n __fish_use_subcommand -a baseline
complete -c offing -n __fish_use_subcommand -a forecast
complete -c offing -n __fish_use_subcommand -a forecast
complete -c offing -n __fish_use_subcommand -a countdown
complete -c offing -n __fish_use_subcommand -a plan
complete -c offing -n __fish_use_subcommand -a status-card
complete -c offing -n __fish_use_subcommand -a glance
complete -c offing -n __fish_use_subcommand -a lookup
complete -c offing -n __fish_use_subcommand -a drift
complete -c offing -n __fish_use_subcommand -a upgrade-check
complete -c offing -n __fish_use_subcommand -a inventory
complete -c offing -n __fish_use_subcommand -a badge
complete -c offing -n __fish_use_subcommand -a diff
complete -c offing -n __fish_use_subcommand -a drift
complete -c offing -n __fish_use_subcommand -a receipt
complete -c offing -n __fish_use_subcommand -a rollup
complete -c offing -n __fish_use_subcommand -a renovate-preset
complete -c offing -n __fish_use_subcommand -a dependabot-config
complete -c offing -n __fish_use_subcommand -a fix
complete -c offing -n __fish_use_subcommand -a check
complete -c offing -n __fish_use_subcommand -a check-snippet
complete -c offing -n __fish_use_subcommand -a guard
complete -c offing -n __fish_use_subcommand -a usage
complete -c offing -n __fish_use_subcommand -a mcp
complete -c offing -n __fish_use_subcommand -a data
complete -c offing -n __fish_use_subcommand -a watch
complete -c offing -n __fish_use_subcommand -a init
complete -c offing -n __fish_use_subcommand -a setup
complete -c offing -n __fish_use_subcommand -a new-detector
complete -c offing -n __fish_use_subcommand -a new-rule
complete -c offing -n __fish_use_subcommand -a rules
complete -c offing -n __fish_use_subcommand -a explain
complete -c offing -n __fish_use_subcommand -a context
complete -c offing -n __fish_use_subcommand -a doctor
complete -c offing -n __fish_use_subcommand -a report-issue
complete -c offing -n __fish_use_subcommand -a capabilities
complete -c offing -n __fish_use_subcommand -a completions
complete -c offing -n __fish_use_subcommand -a hook
complete -c offing -n __fish_use_subcommand -a lsp
complete -c offing -n __fish_use_subcommand -a prompt
complete -c offing -n __fish_use_subcommand -a recommend
complete -c offing -n __fish_use_subcommand -a rollback-readiness
complete -c offing -n __fish_use_subcommand -a timelapse
complete -c offing -n __fish_use_subcommand -a verify
complete -c offing -n __fish_use_subcommand -a wrapped
complete -c offing -n __fish_use_subcommand -l help
complete -c offing -n __fish_use_subcommand -l version
complete -c offing -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'
complete -c offing -n '__fish_seen_subcommand_from data' -a 'status update'
complete -c offing -n '__fish_seen_subcommand_from watch' -a 'add remove run list'
complete -c offing -n '__fish_seen_subcommand_from scan check' -l fail-on -x -a 'info low medium high critical none'
complete -c offing -n '__fish_seen_subcommand_from scan' -l format -x -a 'text json sarif rdjson compact html mermaid'
complete -c offing -n '__fish_seen_subcommand_from forecast' -l format -x -a 'text json sarif rdjson compact html mermaid'
complete -c offing -n '__fish_seen_subcommand_from scan' -l on-expired -x -a 'resurface fail'
complete -c offing -n '__fish_seen_subcommand_from scan' -l demo
complete -c offing -n '__fish_seen_subcommand_from scan' -l json
complete -c offing -n '__fish_seen_subcommand_from scan' -l baseline
complete -c offing -n '__fish_seen_subcommand_from scan' -l baseline-warn-days
complete -c offing -n '__fish_seen_subcommand_from scan' -l today
complete -c offing -n '__fish_seen_subcommand_from scan' -l write-status
complete -c offing -n '__fish_seen_subcommand_from scan' -l interactive
complete -c offing -n '__fish_seen_subcommand_from scan' -l all
complete -c offing -n '__fish_seen_subcommand_from scan' -l by-owner
complete -c offing -n '__fish_seen_subcommand_from scan' -l data-version
complete -c offing -n '__fish_seen_subcommand_from scan' -l only
complete -c offing -n '__fish_seen_subcommand_from scan' -l exclude
complete -c offing -n '__fish_seen_subcommand_from baseline' -l output
complete -c offing -n '__fish_seen_subcommand_from baseline' -l data-version
complete -c offing -n '__fish_seen_subcommand_from forecast' -l months
complete -c offing -n '__fish_seen_subcommand_from forecast' -l as-of
complete -c offing -n '__fish_seen_subcommand_from forecast' -l today
complete -c offing -n '__fish_seen_subcommand_from forecast' -l svg
complete -c offing -n '__fish_seen_subcommand_from forecast' -l animate
complete -c offing -n '__fish_seen_subcommand_from forecast' -l timeline
complete -c offing -n '__fish_seen_subcommand_from forecast' -l json
complete -c offing -n '__fish_seen_subcommand_from forecast' -l format
complete -c offing -n '__fish_seen_subcommand_from forecast' -l data-version
complete -c offing -n '__fish_seen_subcommand_from forecast' -l months
complete -c offing -n '__fish_seen_subcommand_from forecast' -l as-of
complete -c offing -n '__fish_seen_subcommand_from forecast' -l today
complete -c offing -n '__fish_seen_subcommand_from forecast' -l timeline
complete -c offing -n '__fish_seen_subcommand_from forecast' -l json
complete -c offing -n '__fish_seen_subcommand_from forecast' -l format
complete -c offing -n '__fish_seen_subcommand_from forecast' -l data-version
complete -c offing -n '__fish_seen_subcommand_from countdown' -l as-of
complete -c offing -n '__fish_seen_subcommand_from countdown' -l limit
complete -c offing -n '__fish_seen_subcommand_from countdown' -l json
complete -c offing -n '__fish_seen_subcommand_from countdown' -l once
complete -c offing -n '__fish_seen_subcommand_from countdown' -l no-animation
complete -c offing -n '__fish_seen_subcommand_from countdown' -l no-cache
complete -c offing -n '__fish_seen_subcommand_from countdown' -l data-version
complete -c offing -n '__fish_seen_subcommand_from plan' -l json
complete -c offing -n '__fish_seen_subcommand_from plan' -l wave
complete -c offing -n '__fish_seen_subcommand_from plan' -l data-version
complete -c offing -n '__fish_seen_subcommand_from status-card' -l name
complete -c offing -n '__fish_seen_subcommand_from glance' -l as-of
complete -c offing -n '__fish_seen_subcommand_from glance' -l json
complete -c offing -n '__fish_seen_subcommand_from lookup' -l json
complete -c offing -n '__fish_seen_subcommand_from drift' -l json
complete -c offing -n '__fish_seen_subcommand_from drift' -l check
complete -c offing -n '__fish_seen_subcommand_from drift' -l runtime
complete -c offing -n '__fish_seen_subcommand_from drift' -l align
complete -c offing -n '__fish_seen_subcommand_from upgrade-check' -l to
complete -c offing -n '__fish_seen_subcommand_from upgrade-check' -l json
complete -c offing -n '__fish_seen_subcommand_from inventory' -l format
complete -c offing -n '__fish_seen_subcommand_from inventory' -l json
complete -c offing -n '__fish_seen_subcommand_from inventory' -l fail-on
complete -c offing -n '__fish_seen_subcommand_from inventory' -l redact
complete -c offing -n '__fish_seen_subcommand_from badge' -l snippet
complete -c offing -n '__fish_seen_subcommand_from badge' -l repo
complete -c offing -n '__fish_seen_subcommand_from badge' -l branch
complete -c offing -n '__fish_seen_subcommand_from badge' -l shields
complete -c offing -n '__fish_seen_subcommand_from diff' -l json
complete -c offing -n '__fish_seen_subcommand_from diff' -l data-version
complete -c offing -n '__fish_seen_subcommand_from drift' -l json
complete -c offing -n '__fish_seen_subcommand_from drift' -l check
complete -c offing -n '__fish_seen_subcommand_from drift' -l runtime
complete -c offing -n '__fish_seen_subcommand_from drift' -l align
complete -c offing -n '__fish_seen_subcommand_from receipt' -l before
complete -c offing -n '__fish_seen_subcommand_from receipt' -l format
complete -c offing -n '__fish_seen_subcommand_from receipt' -l fail-on-introduced
complete -c offing -n '__fish_seen_subcommand_from receipt' -l json
complete -c offing -n '__fish_seen_subcommand_from rollup' -l owners
complete -c offing -n '__fish_seen_subcommand_from rollup' -l json
complete -c offing -n '__fish_seen_subcommand_from rollup' -l html
complete -c offing -n '__fish_seen_subcommand_from rollup' -l format
complete -c offing -n '__fish_seen_subcommand_from renovate-preset' -l data-version
complete -c offing -n '__fish_seen_subcommand_from dependabot-config' -l data-version
complete -c offing -n '__fish_seen_subcommand_from fix' -l dry-run
complete -c offing -n '__fish_seen_subcommand_from fix' -l show
complete -c offing -n '__fish_seen_subcommand_from fix' -l no-animation
complete -c offing -n '__fish_seen_subcommand_from fix' -l data-version
complete -c offing -n '__fish_seen_subcommand_from check' -l json
complete -c offing -n '__fish_seen_subcommand_from check' -l format
complete -c offing -n '__fish_seen_subcommand_from check' -l data-version
complete -c offing -n '__fish_seen_subcommand_from check-snippet' -l path
complete -c offing -n '__fish_seen_subcommand_from check-snippet' -l json
complete -c offing -n '__fish_seen_subcommand_from guard' -l fail-on
complete -c offing -n '__fish_seen_subcommand_from guard' -l force
complete -c offing -n '__fish_seen_subcommand_from guard' -l data-version
complete -c offing -n '__fish_seen_subcommand_from usage' -l file
complete -c offing -n '__fish_seen_subcommand_from usage' -l json
complete -c offing -n '__fish_seen_subcommand_from data' -l json
complete -c offing -n '__fish_seen_subcommand_from data' -l data-version
complete -c offing -n '__fish_seen_subcommand_from watch' -l weekly
complete -c offing -n '__fish_seen_subcommand_from watch' -l board
complete -c offing -n '__fish_seen_subcommand_from watch' -l json
complete -c offing -n '__fish_seen_subcommand_from init' -l agents
complete -c offing -n '__fish_seen_subcommand_from init' -l hooks
complete -c offing -n '__fish_seen_subcommand_from init' -l personal
complete -c offing -n '__fish_seen_subcommand_from init' -l hooks-for
complete -c offing -n '__fish_seen_subcommand_from init' -l file
complete -c offing -n '__fish_seen_subcommand_from init' -l fail-on
complete -c offing -n '__fish_seen_subcommand_from init' -l yes
complete -c offing -n '__fish_seen_subcommand_from init' -l dry-run
complete -c offing -n '__fish_seen_subcommand_from setup' -l yes
complete -c offing -n '__fish_seen_subcommand_from setup' -l dry-run
complete -c offing -n '__fish_seen_subcommand_from new-detector' -l ecosystem
complete -c offing -n '__fish_seen_subcommand_from new-rule' -l ecosystem
complete -c offing -n '__fish_seen_subcommand_from explain' -l json
complete -c offing -n '__fish_seen_subcommand_from explain' -l data-version
complete -c offing -n '__fish_seen_subcommand_from context' -l json
complete -c offing -n '__fish_seen_subcommand_from context' -l data-version
complete -c offing -n '__fish_seen_subcommand_from doctor' -l system
complete -c offing -n '__fish_seen_subcommand_from doctor' -l json
complete -c offing -n '__fish_seen_subcommand_from doctor' -l data-version
complete -c offing -n '__fish_seen_subcommand_from report-issue' -l output
complete -c offing -n '__fish_seen_subcommand_from report-issue' -l data-version
complete -c offing -n '__fish_seen_subcommand_from capabilities' -l json
complete -c offing -n '__fish_seen_subcommand_from hook' -l fail-on
complete -c offing -n '__fish_seen_subcommand_from prompt' -l format
complete -c offing -n '__fish_seen_subcommand_from prompt' -l symbol
complete -c offing -n '__fish_seen_subcommand_from recommend' -l min-days
complete -c offing -n '__fish_seen_subcommand_from recommend' -l as-of
complete -c offing -n '__fish_seen_subcommand_from recommend' -l json
complete -c offing -n '__fish_seen_subcommand_from rollback-readiness' -l candidate
complete -c offing -n '__fish_seen_subcommand_from rollback-readiness' -l within-days
complete -c offing -n '__fish_seen_subcommand_from rollback-readiness' -l json
complete -c offing -n '__fish_seen_subcommand_from timelapse' -l from
complete -c offing -n '__fish_seen_subcommand_from timelapse' -l to
complete -c offing -n '__fish_seen_subcommand_from timelapse' -l svg
complete -c offing -n '__fish_seen_subcommand_from timelapse' -l json
complete -c offing -n '__fish_seen_subcommand_from timelapse' -l no-animation
complete -c offing -n '__fish_seen_subcommand_from verify' -l data-version
complete -c offing -n '__fish_seen_subcommand_from wrapped' -l year
complete -c offing -n '__fish_seen_subcommand_from wrapped' -l svg
complete -c offing -n '__fish_seen_subcommand_from wrapped' -l json
complete -c offing -n '__fish_seen_subcommand_from wrapped' -l no-animation
