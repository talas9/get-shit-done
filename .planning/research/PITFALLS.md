# Domain Pitfalls

**Domain:** Multi-agent hierarchy integration into GSD (3-tier L1→L2→L3)
**Researched:** 2026-03-11

---

## Critical Pitfalls

Mistakes that cause rewrites, broken builds, or complete loss of the hierarchy benefit.

---

### Pitfall 1: Teammates Cannot Spawn — Hub-and-Spoke Is Mandatory

**What goes wrong:** The GSD architecture plans for L2 sub-orchestrators to spawn L3 agents via the Agent() tool. This assumes teammates can spawn subagents. They cannot. Teammates are stripped of the Agent tool at spawn time — this restriction is undocumented and broader than official docs state.

**Why it happens:** Official documentation says "no nested teams or teammates." The actual restriction is: no Agent, no TeamCreate, no TeamDelete, no CronCreate/Delete/List. Teammates have ~20 tools vs ~25 for standalone subagents. If L2 is spawned as a teammate, it cannot call Agent() to spawn L3 workers.

**Consequences:** L2 sub-orchestrators silently have no way to dispatch L3 work. The entire L1→L2→L3 delegation chain breaks. L2 would have to do all work itself, destroying context isolation.

**Prevention:** L2 sub-orchestrators must be spawned as **standalone subagents** (via Agent() from L1, with run_in_background=true), not as agent team teammates. Only L1 uses TeamCreate. L2s are regular subagents that communicate back to L1 via SendMessage — not teammates in the Claude Code sense of the word.

**Warning signs:**
- L2 prompt says "spawn executor for plan X" but silently fails with no error
- L3 work never starts; L2 returns empty or partial summary
- No SUMMARY.md files written for plans in the stream

**Phase:** Phase 2 (L2 Agent definition) — define gsd-sub-orchestrator.md with Agent tool listed; verify Agent is available in that subagent context before wiring Phase 3 dispatch.

**Source:** [GitHub Issue #32731](https://github.com/anthropics/claude-code/issues/32731) (confirmed tool count discrepancy)

---

### Pitfall 2: Worktree Isolation Does Not Automatically Apply to Background Agents

**What goes wrong:** When using `isolation: "worktree"` in the Task tool to spawn agents in isolated worktrees, background team members still have their working directory set to the main repository. The isolation does not take effect — `pwd` inside the agent still resolves to the main repo.

**Why it happens:** Claude Code's built-in worktree isolation mode sets the worktree path but does not correctly propagate it to agents spawned with run_in_background. This is an open bug (related to GitHub issues #25902, #24508).

**Consequences:** Two L3 agents believe they own different worktrees but are both writing to main. Parallel commits race. File conflicts occur silently. STATE.md gets corrupted by concurrent writes. The git isolation guarantee is broken.

**Prevention:** Do not rely on `isolation: "worktree"` in the Task/Agent tool call itself. Instead, the `gsd-tools.cjs worktree-create` command must create the worktree manually, and the worktree path must be passed **explicitly in the L2 and L3 prompt** via a `<worktree>` tag. L3 agents must `cd` to the worktree path themselves before any file operations.

**Warning signs:**
- Two parallel L3 agents committing to the same branch
- `git log --oneline` showing interleaved commits from different streams on same branch
- STATE.md contents from one stream overwritten by another

**Phase:** Phase 1 (worktree-create command) — the `worktree-create` utility must return the absolute path and the L2/L3 prompt templates must include it explicitly.

**Source:** [GitHub Issue #27749](https://github.com/anthropics/claude-code/issues/27749) — background members don't inherit worktree working directory

---

### Pitfall 3: SendMessage Delivery Is Best-Effort, Not Guaranteed

**What goes wrong:** L1 waits on SendMessage receipts from each L2 to know when streams are complete. If the L2 process crashes after completing work but before the message is delivered (or if delivery receipts are lost), L1 waits indefinitely or proceeds with an incomplete state.

**Why it happens:** Delivery receipts are best-effort. Official docs note: "if the process crashes after markRead() but before the receipt is injected into the sender's session, the sender never learns the recipient read their message." There are no retries built in.

**Consequences:** L1 hangs indefinitely if an L2 crashes mid-stream. Or L1 proceeds to merge/teardown before all streams are done. Worktrees get torn down with uncommitted work still inside them.

**Prevention:**
- L1 must implement a timeout: after N minutes without all L2 SendMessages, query worktree state directly via `gsd-tools.cjs worktree-status` to detect completion
- L2 must write a sentinel file (`STREAM_COMPLETE.md` or `STREAM_FAILED.md`) into its worktree before sending the message — L1 can detect completion by file presence even if SendMessage fails
- Teardown must only happen after L1 verifies the sentinel file exists, not just after receiving the message

**Warning signs:**
- L1 prompt shows "waiting for stream_complete from L2-auth" indefinitely
- `git worktree list` shows worktrees still present long after execution should have finished
- SUMMARY.md exists in worktree but L1 never received the completion message

**Phase:** Phase 3 (L1 dispatch integration) — implement timeout + file-based completion detection before SendMessage-based detection.

---

### Pitfall 4: L2 Context Bloat — The Fat Middle Tier

**What goes wrong:** L2 sub-orchestrators are supposed to stay under 15% context. But if L2 reads PLAN.md content, reads SUMMARY.md outputs from L3, or reads full STATE.md to make routing decisions, its context fills to 40–60% quickly. It becomes a fat middle tier that negates the hierarchy benefit.

**Why it happens:** It feels natural for a coordinator to check on results before reporting them. But each `Read` call of a rich file (PLAN.md ≈ 2–5k tokens, SUMMARY.md ≈ 1–3k tokens, STATE.md ≈ 3–8k tokens) accumulates. Five plans × three files = 30–80k tokens just for validation.

**Consequences:** L2 context approaches limits before the stream is halfway done. The system compacts or loses earlier context. Coordination decisions become unreliable. The benefit of hierarchical isolation is lost.

**Prevention:**
- L2 prompt must include **file paths only**, not file content
- L2 validates L3 completion by checking existence of SUMMARY.md (a single `ls`-equivalent), not reading it
- L2 escalates to L1 on failure by sending the error string, not by re-reading logs
- The L2 agent definition (gsd-sub-orchestrator.md) must explicitly prohibit Read calls except for loading its initial prompt

**Warning signs:**
- L2 agent spending many tokens on "let me review what L3 produced"
- L2 context approaching 30%+ after processing 2–3 plans
- L2 including L3 file content in its SendMessage back to L1

**Phase:** Phase 2 (gsd-sub-orchestrator.md) — agent frontmatter and system prompt must enforce "receive plan IDs, spawn L3 with paths, check file existence, report up."

---

### Pitfall 5: Branch Already Checked Out — Worktree Creation Fails Silently

**What goes wrong:** `git worktree add .claude/worktrees/auth HEAD` fails if the current HEAD branch is already checked out in the main workspace. The error is: `fatal: 'main' is already checked out at '/path/to/main'`. This causes worktree-create to fail with no clear user-facing error.

**Why it happens:** Git enforces that a branch can only be checked out in one worktree at a time. If the main branch is `main` and L1 runs from `main`, trying to create a worktree from `main` fails.

**Consequences:** `gsd-tools.cjs worktree-create` throws, the L2 spawn is never attempted for that stream, and L1 either crashes or skips the stream silently. Work for that stream is lost.

**Prevention:**
- `worktree-create` must always create a **new branch** for each stream (e.g., `gsd-phase-3-auth-<timestamp>`), never reuse main
- The branch must not exist yet — include timestamp or hash in branch name to guarantee uniqueness
- `worktree-create` must check the error output from `git worktree add` and surface it to L1 before L1 tries to spawn L2 for that stream

**Warning signs:**
- `gsd-tools.cjs worktree-create` returns non-zero exit code
- `git worktree list` shows fewer worktrees than expected L2 streams
- L1 spawns fewer L2s than there are streams

**Phase:** Phase 1 (worktree-create command implementation) — branch naming scheme must be defined and tested before Phase 3 wiring.

---

## Moderate Pitfalls

### Pitfall 6: STATE.md Merge Conflict After Parallel Streams

**What goes wrong:** Both L3 streams update STATE.md inside their worktrees. When L1 merges the worktrees back to main, the STATE.md changes conflict because both branches have different "current phase task" values.

**Prevention:**
- `gsd-tools.cjs state-reconcile` must be built before Phase 3 wiring — it takes the set of completed plan IDs from each worktree and merges them into the main STATE.md
- The reconcile strategy is: union of completed tasks (not last-writer-wins) for task lists; last-writer-wins for scalar phase status fields
- ARCHITECTURE.md already documents this requirement; it just needs to be implemented in Phase 1 alongside worktree commands

**Warning signs:**
- `git merge` or cherry-pick fails on STATE.md after worktree merge
- Phase completion status showing inconsistent counts (some tasks from stream A missing)

**Phase:** Phase 1 (hierarchy.cjs) — implement `state-reconcile` as part of worktree teardown, not as an afterthought in Phase 3.

---

### Pitfall 7: Agent Teams Is Experimental — Feature May Break Between Versions

**What goes wrong:** The TeamCreate/SendMessage/agent teams feature is explicitly marked experimental and disabled by default in Claude Code (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag required). Known limitations include: no session resumption with in-process teammates, task status can lag, shutdown can be slow, and one team per session.

**Why it matters for GSD:**
- If the user upgrades Claude Code and agent teams changes behavior or breaks, GSD's `hierarchy.enabled=true` path fails completely
- "Task status can lag" means SendMessage delivery issues are documented, not theoretical
- Session resumption failure means if the user runs `/resume` during hierarchy execution, L2/L3 state is lost

**Prevention:**
- The feature flag `hierarchy.enabled` defaults to `false` (already planned) — this is the correct mitigation
- Document in the GSD config that `hierarchy.enabled=true` requires Claude Code to have agent teams experimental feature enabled
- Do not depend on Claude Code's session resumption working during hierarchy execution — treat each hierarchy run as non-resumable (checkpoint to file before any destructive operation)

**Warning signs:**
- Claude Code upgraded and /gsd:execute-phase silently falls back to flat mode
- TeamCreate returns error or team isn't created

**Phase:** Phase 3 (L1 dispatch integration) — L1 dispatch must check for TeamCreate success and fall back to flat mode on failure rather than crashing.

---

### Pitfall 8: Worktree Teardown Orphans When L1 Crashes Mid-Execution

**What goes wrong:** If L1 crashes or the user interrupts execution after worktrees are created but before teardown, the worktrees persist at `.claude/worktrees/<stream>`. Git won't let you re-create them on the next run because the paths exist. Future `gsd-tools.cjs worktree-create` calls fail.

**Prevention:**
- `worktree-create` must write the worktree name to a registry file (e.g., `.planning/hierarchy-state.json`) immediately after creation
- At the start of every hierarchy-enabled execution, L1 must call `worktree-teardown --orphan-check` to clean up any leftover worktrees from a previous interrupted run
- This check must happen before `TeamCreate` so the slate is clean

**Warning signs:**
- `git worktree list` shows `.claude/worktrees/` entries from a previous run
- `worktree-create` fails with "path already exists"
- `.planning/hierarchy-state.json` shows streams marked "in-progress" from a prior session

**Phase:** Phase 1 (hierarchy.cjs) — registry file and orphan cleanup must be part of `worktree-create` and `worktree-teardown` from day one.

---

### Pitfall 9: MCP Context Pollution When L2 Accidentally Gets MCP Access

**What goes wrong:** If L2's system prompt doesn't explicitly restrict MCP tools, L2 inherits the team lead's permission settings including MCP server access. L2 might call MCP tools "helpfully" to gather context — filling its 15% context budget with MCP responses.

**Prevention:**
- The gsd-sub-orchestrator.md frontmatter `tools:` list must explicitly enumerate only: `Agent`, `SendMessage`, `Read` — omitting all MCP and Bash tools
- Claude Code respects the `tools:` frontmatter in agent definitions to restrict available tools
- Add an explicit line in the L2 system prompt: "You do not have access to MCP tools. Do not attempt to call any. Pass MCP-dependent work to L3 agents via Agent()."

**Warning signs:**
- L2 context climbing rapidly before any L3 agents are spawned
- L2 tool calls including `mcp__` prefixed tools
- L2 returning results that could only come from an MCP data source

**Phase:** Phase 2 (gsd-sub-orchestrator.md) — tool restriction is a frontmatter property, set it correctly from the start.

---

### Pitfall 10: Hierarchy Partition Assigns Dependent Plans to Different Streams

**What goes wrong:** The `hierarchy-partition` command splits plans across streams. If plans with dependencies land in different streams, the parallel execution breaks. Stream A commits plan 3.1, Stream B needs plan 3.1's output to run plan 3.3, but Stream B starts at the same time as Stream A.

**Why it happens:** Simple round-robin or alphabetical partitioning ignores intra-phase plan dependencies. The existing wave grouping in GSD handles within-phase sequencing, but that sequencing information must be respected during stream partitioning.

**Consequences:** L3 executor for plan 3.3 reads stale or missing output from plan 3.1. The work is wrong but no error is surfaced. Downstream verifier catches it (best case) or it ships (worst case).

**Prevention:**
- `hierarchy-partition` must treat each wave as an atomic unit — plans in the same wave can be split across streams, but wave N must not land in a different stream than wave N-1 if they have a producer-consumer relationship
- The safest partition strategy: each stream owns a contiguous slice of waves; streams diverge only where no cross-stream data dependency exists
- For v1, default to conservative: one stream per independent sub-graph of plans (determined by dependency edges), not one stream per arbitrary split

**Warning signs:**
- L3 executor reporting "prerequisite output not found" for a plan that should have been run by a sibling stream
- Plans completing in the wrong logical order within a stream

**Phase:** Phase 1 (hierarchy-partition command) — dependency-aware partitioning must be spec'd and tested before Phase 3.

---

## Minor Pitfalls

### Pitfall 11: Broadcast Overuse Multiplies Token Costs

**What goes wrong:** L1 uses SendMessage broadcast to notify all L2s simultaneously of a decision or update. Each broadcast multiplies token cost by team size.

**Prevention:** L1 should only use targeted SendMessage (to a specific stream L2) for stream-specific updates. Broadcast is only appropriate for global halts (e.g., "abort all streams, critical error detected").

**Phase:** Phase 3 (execute-phase.md L1 dispatch template).

---

### Pitfall 12: Checkpoint Bubbling Creates Deadlock

**What goes wrong:** L3 hits a human-action checkpoint and sends it up to L2. L2 sends it up to L1 via SendMessage. L1 waits for the checkpoint to be resolved by the user. Meanwhile, all other L2 streams continue executing and may complete. The user hasn't seen the checkpoint yet. L1 is blocked on the checkpoint SendMessage while L2s are piling up completion messages that L1 can't process.

**Prevention:**
- L1 must not block on a single SendMessage — it must use a non-blocking receive loop
- Checkpoints from any stream must pause **that stream only**, not L1
- L1 presents the checkpoint to the user while other streams continue and it collects their completions in a queue

**Phase:** Phase 3 (L1 dispatch integration) — the SendMessage receive loop design must handle interleaved completion and checkpoint messages.

---

### Pitfall 13: config.json Hierarchy Keys Silently Ignored If Schema Not Registered

**What goes wrong:** GSD's `loadConfig()` in `core.cjs` currently has hardcoded defaults with no `hierarchy` key. If a user manually adds `"hierarchy": { "enabled": true }` to their `config.json` before GSD registers it, the key is silently ignored — or worse, causes a silent JSON parse degradation (per CONCERNS.md bug: corrupted config falls back to defaults without warning).

**Prevention:**
- Phase 3 must add `hierarchy` key with defaults to `loadConfig()` before execute-phase.md reads it
- The `hierarchy.enabled` key must be listed in config schema validation so unknown-value errors surface
- Respect the existing silent-fallback bug: if `loadConfig()` fails on config.json, `hierarchy.enabled` must default to `false` (safe fallback, not `true`)

**Phase:** Phase 3 (config.json extension) — schema registration before any workflow reads the key.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: worktree-create | Branch already checked out; orphaned worktrees from prior crash | Always create new timestamped branch; orphan-check on startup |
| Phase 1: hierarchy-partition | Dependent plans split across streams | Dependency-aware partition; conservative default (contiguous waves per stream) |
| Phase 1: state-reconcile | STATE.md merge conflict after parallel streams | Union strategy for task lists; implement before Phase 3 |
| Phase 2: gsd-sub-orchestrator.md | L2 accidentally uses Agent or MCP tools | Explicit tool whitelist in frontmatter; verify Agent() is available in subagent (not teammate) context |
| Phase 3: L1 dispatch | L2 spawned as teammate (cannot spawn L3) | Spawn L2 as Agent() subagent, not as team teammate |
| Phase 3: L1 dispatch | SendMessage delivery failure causes L1 hang | Sentinel file + timeout fallback before relying solely on SendMessage |
| Phase 3: execute-phase.md | TeamCreate failure crashes instead of falling back | Wrap TeamCreate in try-fallback to flat mode |
| Phase 4: validation | Worktree isolation not actually isolating | Verify L3 `pwd` resolves to worktree path, not main repo, before accepting Phase 1 as done |

---

## Sources

- Official docs: [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) — limitations, hub-and-spoke architecture, best practices
- GitHub Issue: [#32731 — Teammates have fewer tools than subagents](https://github.com/anthropics/claude-code/issues/32731) — tool count discrepancy, confirmed
- GitHub Issue: [#27749 — Worktree background member pwd not updated](https://github.com/anthropics/claude-code/issues/27749) — isolation bug
- Guide: [claudefa.st Agent Teams Complete Guide](https://claudefa.st/blog/guide/agents/agent-teams) — pitfall patterns (MEDIUM confidence — verified against official docs)
- Guide: [claudefa.st Worktrees Guide](https://claudefa.st/blog/guide/development/worktree-guide) — merge conflict and port conflict patterns (MEDIUM confidence)
- Project context: `.planning/PROJECT.md` — requirements, constraints, out-of-scope items
- Codebase: `.planning/codebase/CONCERNS.md` — existing tech debt (silent JSON fallback, regex fragility)
- Architecture: `.planning/research/ARCHITECTURE.md` — L1/L2/L3 boundary definitions and build order

**Confidence levels:**
- Pitfalls 1, 2, 3, 7: HIGH — sourced from official docs or confirmed GitHub issues
- Pitfalls 4, 5, 8, 9: HIGH — derived directly from codebase analysis + confirmed architectural constraints
- Pitfalls 6, 10: MEDIUM — architectural inference from existing GSD codebase + documented git worktree behavior
- Pitfalls 11, 12, 13: MEDIUM — inferred from official docs patterns + CONCERNS.md existing bugs
