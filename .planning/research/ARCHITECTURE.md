# Architecture Patterns

**Domain:** Multi-agent orchestration system — 3-tier hierarchy integration into GSD
**Researched:** 2026-03-11

---

## Existing Architecture Baseline

GSD currently operates a **2-level flat model**:

```
L1: Orchestrator (command/workflow running in main context)
    ↓  Task(subagent_type="gsd-executor", ...)
L2: Subagents (gsd-executor, gsd-planner, gsd-verifier, etc.)
    — do all work, return summaries
```

Key properties of the current model:
- Orchestrator is **blocking** — it calls `Task()` and waits
- Orchestrator context is held throughout (target: 10–15%)
- Subagents get fresh 200k context, read their own files via `<files_to_read>`, produce SUMMARY.md
- Wave grouping provides logical parallelism within the flat model
- `gsd-tools.cjs` handles all state mutations atomically

---

## Recommended Architecture: 3-Tier Hierarchical Model

### Tier Definitions

```
L1: Main Orchestrator (command/workflow in user's session)
    — Reads config, discovers work streams, spawns L2s via run_in_background
    — Owns the team (TeamCreate), coordinates SendMessage receipt
    — Never calls MCP, never runs Bash exploration, never does implementation
    — Context budget: ≤ 15%

        ↓  Agent(subagent_type="gsd-sub-orchestrator", run_in_background=true, team_name=...)
        ↓  SendMessage (receives status from L2)

L2: Sub-Orchestrators (one per independent work stream)
    — Each owns a git worktree for isolation (.claude/worktrees/<stream>)
    — Spawns L3 agents via Agent() — may use run_in_background within stream
    — No Bash execution, no MCP calls, no direct file writes
    — Allowed tools: Agent, SendMessage, Read (context loading only)
    — Reports to L1 via SendMessage on completion or failure
    — Context budget: ≤ 15%

        ↓  Agent(subagent_type="gsd-executor" | "gsd-verifier" | ..., ...)

L3: Worker Agents (existing gsd-executor, gsd-planner, gsd-verifier, etc.)
    — All actual implementation work happens here
    — Full tool access: Bash, Write, MCP, gsd-tools.cjs
    — Same agents as today — no changes to their definitions
    — Commit atomically, write SUMMARY.md, update STATE.md
```

### Component Boundaries

| Component | Tier | Responsibility | Communicates With |
|-----------|------|----------------|-------------------|
| `execute-phase.md` workflow | L1 | Load config, partition streams, create team, spawn L2s, aggregate | L2s via SendMessage; gsd-tools.cjs for state |
| `gsd-sub-orchestrator.md` agent | L2 | Own a stream (set of plans/phases), sequence L3 agents, report up | L1 via SendMessage; L3 via Agent() |
| `gsd-executor.md` agent | L3 | Execute a single PLAN.md, commit per task, write SUMMARY.md | gsd-tools.cjs; filesystem; git |
| `gsd-verifier.md` agent | L3 | Verify phase/plan completion, write VERIFICATION.md | gsd-tools.cjs; filesystem |
| `gsd-planner.md` agent | L3 | Generate PLAN.md from context | filesystem; gsd-tools.cjs |
| `gsd-tools.cjs` | Utility | 100+ atomic state operations | All L3 agents (Bash), L1 (Bash for init) |
| `.planning/config.json` | Config | Feature flags, model profiles, hierarchy settings | L1 reads on startup |
| `hierarchy.cjs` (new) | Utility | Worktree lifecycle, team management helpers | L1 and L2 orchestration flows |

---

## Data Flow: L1 → L2 → L3

### Phase Execution with Hierarchy Enabled

```
1. User: /gsd:execute-phase 3

2. L1 Orchestrator (execute-phase.md workflow):
   a. gsd-tools.cjs init execute-phase "3"       → JSON: plans, waves, config
   b. gsd-tools.cjs hierarchy-partition "3"      → JSON: streams[] (each stream = set of waves/plans)
   c. TeamCreate(team_name="gsd-phase-3-<ts>")
   d. For each stream S:
      - gsd-tools.cjs worktree-create S.name     → worktree path
      - Agent(
          subagent_type="gsd-sub-orchestrator",
          run_in_background=true,
          team_name="gsd-phase-3-<ts>",
          prompt="<worktree>{path}</worktree>
                  <stream_plans>{S.plans}</stream_plans>
                  <team_name>gsd-phase-3-<ts></team_name>"
        )
   e. L1 waits on SendMessage from each L2 ("stream_complete" | "stream_failed")

3. L2 Sub-Orchestrator (gsd-sub-orchestrator.md agent):
   a. Reads stream_plans list from prompt
   b. For each plan P in stream (respecting wave order within stream):
      - Agent(subagent_type="gsd-executor", prompt="<worktree>...<plan>P</plan>")
      - Wait for return
      - Verify SUMMARY.md exists (spot-check)
      - If checkpoint: handle or bubble up to L1 via SendMessage
   c. After all plans: SendMessage(team="gsd-phase-3-<ts>", msg="stream_complete: {summary}")

4. L3 Worker (gsd-executor.md agent — unchanged):
   a. Read PLAN.md, STATE.md, config.json (from worktree path)
   b. Execute tasks, commit per task to worktree branch
   c. Write SUMMARY.md
   d. Update STATE.md (worktree-local)
   e. Return to L2

5. L1 resumes after all L2 SendMessages received:
   a. gsd-tools.cjs worktree-merge <each stream>  → cherry-pick or merge worktrees into main
   b. gsd-tools.cjs worktree-teardown <each stream>
   c. Spawn gsd-verifier (L3 directly — single agent, no L2 needed)
   d. Update ROADMAP.md, STATE.md, offer next
```

### Fallback Flow (hierarchy.enabled = false)

```
1. L1 reads config: hierarchy.enabled = false
2. Execute-phase.md follows existing wave-based Task() loop exactly
3. Zero behavior change — L2/L3 concepts invisible to user
```

---

## Integration Points with Existing System

### config.json Extension

```json
{
  "hierarchy": {
    "enabled": false,
    "mcp_isolation": true,
    "worktree_isolation": true,
    "team_communication": true,
    "max_parallel_streams": 4
  }
}
```

The `hierarchy.enabled` gate wraps the dispatch decision in `execute-phase.md`. All other existing config keys remain untouched. Individual toggles under `hierarchy` allow incremental adoption (e.g., use team communication without worktrees).

### execute-phase.md Modification

The existing workflow gains a **dispatch branch** at the top of the `execute_waves` step:

```
IF hierarchy.enabled:
  → partition plans into streams
  → use TeamCreate + L2 spawning path
ELSE:
  → existing wave-based Task() loop (unchanged)
```

No other workflows need modification for the initial integration.

### gsd-tools.cjs Extensions

Three new command groups required:

| Command Group | Purpose | Example Commands |
|---------------|---------|-----------------|
| `hierarchy-*` | Partition plans into streams | `hierarchy-partition <phase>` → streams JSON |
| `worktree-*` | Worktree lifecycle | `worktree-create <name>`, `worktree-teardown <name>`, `worktree-merge <name>` |
| `team-*` | Team name generation | `team-name <phase>` → `gsd-phase-3-<ts>` |

These are new commands in `gsd-tools.cjs` backed by a new `hierarchy.cjs` lib module. They do not touch existing modules.

### New Agent: gsd-sub-orchestrator.md

A new agent persona in `agents/gsd-sub-orchestrator.md`:

- **Tools:** Agent, SendMessage, Read (no Bash, no Write, no MCP)
- **Role:** Sequence L3 agents for an assigned stream, handle intra-stream checkpoints, report stream status to L1 via SendMessage
- **Context discipline:** Reads only plan filenames from prompt (not content — L3 reads content), delegates immediately

This is the only new agent file. Existing agents (gsd-executor, gsd-verifier, etc.) are L3 workers and require no modification.

### STATE.md Compatibility

L3 agents write to STATE.md within their worktree. After merging worktrees, L1 runs a reconcile step via `gsd-tools.cjs state-reconcile` that takes the last-writer value for scalar fields and merges plan completion lists. This is the only new STATE.md concern — the schema itself does not change.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: L2 Does Work
**What:** L2 sub-orchestrator reads files, writes output, calls gsd-tools.cjs
**Why bad:** Fills L2 context with details; defeats context isolation; L2 becomes a fat middle tier
**Instead:** L2 receives plan IDs only, spawns L3 with file paths, waits for return

### Anti-Pattern 2: L1 Blocks on Single L2
**What:** L1 spawns L2s sequentially, waits for each before spawning the next
**Why bad:** Eliminates parallelism benefit entirely
**Instead:** All L2s spawned with `run_in_background=true` before L1 waits; L1 collects via SendMessage

### Anti-Pattern 3: L3 Sends Messages to L1 Directly
**What:** gsd-executor uses SendMessage to report directly to the team
**Why bad:** L1 receives messages from N*M agents; coordination complexity scales with plan count
**Instead:** L3 returns to L2; L2 aggregates stream result; L2 sends single message to L1

### Anti-Pattern 4: Worktree State Leaks Into Main
**What:** L3 commits go directly to the main branch during hierarchy execution
**Why bad:** Partial, parallel, potentially conflicting commits visible to main context
**Instead:** All L3 commits land in their stream's worktree branch; L1 merges after all streams complete

### Anti-Pattern 5: Tight Coupling of Hierarchy to Agent Definitions
**What:** L3 agent prompts embed hierarchy-specific logic (team names, SendMessage calls)
**Why bad:** Breaks non-hierarchical usage; agents can no longer be spawned directly
**Instead:** Hierarchy logic lives entirely in L1/L2 dispatch; L3 agents are unmodified

---

## Suggested Build Order (Dependencies)

```
Phase 1: Foundation (enables the rest)
  1a. gsd-tools.cjs: add worktree-* commands (worktree-create, worktree-teardown, worktree-merge)
  1b. gsd-tools.cjs: add hierarchy-partition command (stream assignment logic)
  1c. get-shit-done/bin/lib/hierarchy.cjs: new module backing these commands

Phase 2: L2 Agent (required before L1 dispatch can be wired)
  2a. agents/gsd-sub-orchestrator.md: new agent persona (no-Bash, no-MCP discipline)
  2b. Update bin/install.js: register gsd-sub-orchestrator for agent runtimes

Phase 3: L1 Dispatch Integration (requires Phase 1 + 2)
  3a. config: add hierarchy.* keys with defaults to loadConfig() in core.cjs
  3b. execute-phase.md: add hierarchy dispatch branch (if/else gate around existing wave loop)
  3c. gsd-tools.cjs: add team-name helper, state-reconcile command

Phase 4: Feature Flag Validation
  4a. Test: hierarchy.enabled=false → behavior identical to pre-feature behavior
  4b. Test: hierarchy.enabled=true → L1→L2→L3 flow with real plans
  4c. Test: worktree isolation (parallel commits don't conflict)
  4d. Test: teardown cleanup (no orphaned worktrees after execution)
```

Dependencies:
- Phase 2 can begin in parallel with Phase 1
- Phase 3 requires both Phase 1 and Phase 2 complete
- Phase 4 requires Phase 3 complete

---

## Scalability Considerations

| Concern | Flat Model (today) | Hierarchy (new) |
|---------|--------------------|-----------------|
| 5 parallel plans | Wave-based Task() — orchestrator waits on all 5 | Same; L2 sequences within stream |
| 20 parallel plans | Orchestrator spawns 20 Tasks — context fills fast | L1 spawns 4 L2s (5 plans each) — L1 stays at ~15% |
| Cross-plan dependencies | Wave grouping handles within-phase | Stream assignment must respect cross-stream deps (hierarchy-partition must be dep-aware) |
| Context pollution | L1 accumulates all 20 SUMMARY reads | L2 accumulates its stream's summaries; L1 gets single report per stream |
| Git conflicts | Wave ordering prevents most conflicts | Worktree isolation eliminates intra-execution conflicts entirely |

---

## Sources

- Project context: `.planning/PROJECT.md` (2026-03-11) — requirements and constraints
- Architecture analysis: `.planning/codebase/ARCHITECTURE.md` (2026-03-11) — existing layer descriptions
- Structure analysis: `.planning/codebase/STRUCTURE.md` (2026-03-11) — file locations
- Execute-phase workflow: `get-shit-done/workflows/execute-phase.md` — current wave/agent dispatch pattern
- Core utilities: `get-shit-done/bin/lib/core.cjs` — model profiles, loadConfig defaults
- Config snapshot: `.planning/config.json` — existing config keys (no hierarchy keys yet)
- User CLAUDE.md: 3-tier hierarchy pattern definition (the pattern being integrated)

**Confidence: HIGH** — all findings derived from direct codebase reading, not external sources.
