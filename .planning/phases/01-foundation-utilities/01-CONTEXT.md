# Phase 1: Foundation Utilities - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Add gsd-tools.cjs CLI commands for worktree management, dependency-aware plan partitioning, state reconciliation, and config schema extension. These are internal utilities consumed by Phase 3 (dispatch integration). No user-facing workflow changes.

</domain>

<decisions>
## Implementation Decisions

### Worktree commands
- `worktree-create` uses timestamped branch names: `gsd/hierarchy/{timestamp}-{stream-name}` to avoid "branch already checked out" errors (bug #27749 workaround)
- `worktree-create` registers in `.planning/worktree-registry.json` with creation time, branch name, stream assignment, and status
- `worktree-remove` cleans up branch + registry entry; `--force` handles orphaned/failed worktrees
- Worktree path: `.claude/worktrees/{stream-name}` (consistent with CLAUDE.md hierarchy convention)

### Partition command
- `hierarchy-partition` reads all plan files in a phase directory
- Groups plans into non-conflicting streams by analyzing `depends_on` fields and file overlap (files referenced in plan tasks)
- Respects existing wave ordering — plans in the same wave can split across streams, cross-wave deps stay sequential within a stream
- Output: JSON partition map `{ streams: [{ name, plans: [], worktree_branch }] }`

### State reconciliation
- `state-reconcile` merges STATE.md changes from worktree branches back to main
- Strategy: append-safe for task completion records, last-write for scalar fields (current phase, last activity)
- Reads worktree registry to know which branches to reconcile

### Config schema
- `hierarchy` section added to config.json schema: `{ enabled: bool, max_l2_agents: int }`
- Hierarchy activates ONLY when both `parallelization: true` AND `hierarchy.enabled: true`
- Default: `hierarchy.enabled: false` — zero behavior change for existing users

### Claude's Discretion
- Internal module organization within gsd-tools.cjs (new `hierarchy.cjs` lib module vs inline)
- Exact worktree registry JSON schema fields beyond the required ones
- Error message wording for partition failures
- Whether `state-reconcile` uses git merge or manual file merge

</decisions>

<specifics>
## Specific Ideas

- Follow existing gsd-tools.cjs command patterns — same arg parsing, same error handling
- Worktree registry should be self-healing — if a registered worktree doesn't exist on disk, auto-clean the entry
- Partition output should be human-readable when printed (not just machine JSON)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `gsd-tools.cjs` existing command structure — follow established patterns for new commands
- `lib/` modules in gsd-tools — existing pattern for separating concerns

### Established Patterns
- Commands use `process.argv` parsing with positional args and `--flags`
- JSON output for machine consumption, formatted text for human display
- Git operations via child_process exec

### Integration Points
- New commands registered in gsd-tools.cjs main dispatch
- Config schema validation in existing config read/write paths
- Worktree registry read by Phase 3 dispatch logic

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-utilities*
*Context gathered: 2026-03-12*
