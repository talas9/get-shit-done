# Phase 3: L1 Dispatch Integration - Research

**Researched:** 2026-03-12
**Domain:** execute-phase.md workflow modification — hierarchy dispatch branch, file-based L2 completion detection, worktree merge/cleanup, graceful fallback
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DISP-01 | Conditional branch in `execute-phase.md` — checks `parallelization: true` AND `hierarchy.enabled: true`, otherwise uses existing flat path | `init execute-phase` currently returns `parallelization` but NOT `hierarchy` — init.cjs must be patched to expose `hierarchy.enabled` before the workflow can branch on it |
| DISP-02 | L1 spawns all L2s with `run_in_background: true` — L1 never blocks | Workflow uses `Task()` for executor spawning; same pattern applies for L2 spawn with `run_in_background: true`. L2 return value is the completion signal (text output). |
| DISP-03 | Each L2 spawned in its own worktree (worktrees required, not optional) | `worktree-create <stream-name>` from hierarchy.cjs creates the worktree and returns `{ path, branch }`. The path must be injected into L2 prompt via `<worktree>` tag (bug #27749 workaround). |
| DISP-04 | File-based completion detection — L2 writes sentinel file before returning (fallback for unreliable SendMessage) | L2 agent returns structured text: `STREAM_COMPLETE: {name}` or `STREAM_FAILED: {name}`. L1 reads this return text. No separate sentinel file is written by L2 (it has no Write tool). L1 can also verify by checking SUMMARY.md existence per plan. |
| DISP-05 | L1 merges worktrees back to main branch after all L2s complete | `git merge` per worktree branch, then `worktree-remove <stream-name>` which calls `git worktree remove --force` + `git branch -D`. `state-reconcile` merges STATE.md from all registered worktrees before removal. |
| DISP-06 | Graceful fallback — any hierarchy failure auto-falls back to flat execution mode with user notification | Try/catch wrapping hierarchy setup; any failure in partition, worktree-create, or L2 spawn triggers cleanup + flat fallback. Flat path is the existing `execute_waves` step. |
</phase_requirements>

---

## Summary

Phase 3 modifies a single file — `get-shit-done/workflows/execute-phase.md` — and patches one Node.js function (`cmdInitExecutePhase` in `init.cjs`) to expose the `hierarchy` config block. The workflow change adds a dispatch branch immediately after the `discover_and_group_plans` step: when both `parallelization` and `hierarchy.enabled` are true, L1 takes the hierarchy path instead of the flat `execute_waves` path.

The hierarchy path has five sub-steps: (1) spawn a partitioner L3 to get the stream map, (2) create one worktree per stream via `worktree-create`, (3) spawn one L2 per stream with `run_in_background: true`, (4) poll until all L2s complete by checking their return text (which is structured as `STREAM_COMPLETE:` / `STREAM_FAILED:`), and (5) merge all worktrees back to main (git merge + `state-reconcile` + `worktree-remove`). Any failure in steps 1-4 triggers cleanup and falls back to the original flat `execute_waves` step.

A critical gap was found during research: `init execute-phase` does not currently include `hierarchy` in its JSON output. The workflow reads config values exclusively from the init call. This means `init.cjs` must be patched to add `hierarchy_enabled` and `hierarchy_max_l2_agents` to `cmdInitExecutePhase` output before the workflow can read these flags. This is a small targeted change to one function.

**Primary recommendation:** Patch `init.cjs` first (adds `hierarchy_enabled` to init output), then modify `execute-phase.md` to add the dispatch branch after `discover_and_group_plans`, then add test coverage for the init patch in `tests/init.test.cjs`.

---

## Standard Stack

### Core (existing, no new dependencies)
| Asset | Version/Location | Purpose | Why Standard |
|-------|-----------------|---------|--------------|
| `get-shit-done/workflows/execute-phase.md` | Project file | Workflow to modify — adds hierarchy dispatch branch | This is THE file that DISP-01 through DISP-06 modify |
| `get-shit-done/bin/lib/init.cjs` | Project file | Must expose `hierarchy` config via `cmdInitExecutePhase` | All workflow config reads come from init JSON |
| `get-shit-done/bin/lib/hierarchy.cjs` | Phase 1 deliverable | `cmdWorktreeCreate`, `cmdWorktreeRemove`, `cmdStateReconcile` | Phase 1 built these; Phase 3 calls them |
| `agents/gsd-sub-orchestrator.md` | Phase 2 deliverable | L2 agent persona — receives stream + worktree, spawns L3s | Phase 2 built this; Phase 3 spawns it |
| `agents/gsd-partitioner.md` | Phase 2 deliverable | L3 partitioner — calls `hierarchy-partition`, returns stream map | Phase 2 built this; Phase 3 spawns it before L2 dispatch |

### CLI Commands Used by Workflow (all from Phase 1)
| Command | Invocation | Returns |
|---------|-----------|---------|
| `worktree-create <name>` | `node gsd-tools.cjs worktree-create stream-a` | `{ created: true, stream, branch, path }` |
| `worktree-remove <name>` | `node gsd-tools.cjs worktree-remove stream-a` | `{ removed: true, stream }` |
| `state-reconcile` | `node gsd-tools.cjs state-reconcile` | `{ merged: true, worktrees_merged: N }` |
| `hierarchy-partition <dir>` | Called by partitioner agent, not directly by L1 | N/A (L1 reads partitioner output) |

**No new npm packages needed.** This phase only modifies workflow Markdown files and one Node.js function.

---

## Architecture Patterns

### Key Insight: `init execute-phase` Must Expose `hierarchy`

The execute-phase workflow reads ALL config from the init call:
```bash
INIT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" init execute-phase "${PHASE_ARG}")
```

Currently the init JSON includes `parallelization` (line 33 of init.cjs) but does NOT include `hierarchy`. The workflow must branch on `hierarchy.enabled` but has no way to read it without patching init.

**Fix:** Add to `cmdInitExecutePhase` return object in `init.cjs`:
```javascript
hierarchy_enabled: config.hierarchy.enabled,
hierarchy_max_l2_agents: config.hierarchy.max_l2_agents,
```

`loadConfig()` in `core.cjs` already reads `hierarchy` from config.json with defaults `{ enabled: false, max_l2_agents: 3 }` (line 83 of core.cjs). The values exist in `config` — they just aren't being forwarded to the init output.

### Pattern 1: Hierarchy Dispatch Branch in execute-phase.md

**Where to insert:** Between `discover_and_group_plans` step and `execute_waves` step.

**Condition:**
```
IF PARALLELIZATION == true AND HIERARCHY_ENABLED == true:
  → hierarchy dispatch path (new)
ELSE:
  → existing execute_waves path (unchanged)
```

**Why this location:** The plan inventory (plan list + wave grouping) is already computed by `discover_and_group_plans`. The hierarchy path needs this inventory to spawn the partitioner. The flat path (`execute_waves`) is unchanged — it receives the same plan inventory and proceeds as today.

### Pattern 2: Partitioner Spawn (Step 1 of Hierarchy Path)

L1 spawns the `gsd-partitioner` agent to get the stream map:

```
Task(
  subagent_type="gsd-partitioner",
  prompt="
    <phase_dir>{phase_dir}</phase_dir>
  "
)
```

Parse the JSON output. If partitioner fails or returns `{ streams: [] }`, fall back to flat mode.

**Decision point:** If only 1 stream is returned, still use hierarchy path (creates 1 worktree, spawns 1 L2). This is valid — hierarchy overhead is low and the behavior is still correct. Alternatively, fall back to flat if only 1 stream. This is a Claude's Discretion call (see Open Questions).

### Pattern 3: Worktree Creation (Step 2 of Hierarchy Path)

For each stream in partitioner output:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-create {stream.name}
```

Returns `{ path: ".claude/worktrees/{stream-name}", branch: "gsd/hierarchy/{timestamp}-{stream-name}" }`.

Store the path for L2 prompt injection. If any `worktree-create` call fails, fall back to flat (after removing any worktrees already created).

**Critical:** Cleanup on partial failure — if stream-a worktree is created but stream-b fails, stream-a must be removed before falling back:
```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-remove stream-a
```

### Pattern 4: L2 Spawn with run_in_background (Step 3 of Hierarchy Path)

Each L2 is spawned as a standalone subagent (NOT using TeamCreate — bug #32731 forbids it) with `run_in_background: true`:

```
Task(
  subagent_type="gsd-sub-orchestrator",
  run_in_background=true,
  prompt="
    <worktree>{absolute_worktree_path}</worktree>
    <phase>{phase}</phase>
    <phase_dir>{phase_dir}</phase_dir>
    <stream>{ \"name\": \"{stream.name}\", \"plans\": [{plan_list}] }</stream>
  "
)
```

**Why `run_in_background: true`:** DISP-02 requires L1 never blocks on a single L2. With `run_in_background: true`, L1 spawns all L2s at once. L2s run concurrently.

**Return value vs sentinel file:** The L2 agent returns structured text on completion: `STREAM_COMPLETE: {name}` or `STREAM_FAILED: {name}`. L1 reads these return values after background tasks complete. This is what `gsd-sub-orchestrator.md` produces (see `<output>` section of agent).

### Pattern 5: Completion Detection (Step 4 of Hierarchy Path)

After spawning all L2s with `run_in_background: true`, L1 waits for them to complete by reading their return values (not blocking on individual L2s, but waiting for the batch).

**L2 return text signals:**
- `STREAM_COMPLETE: {stream_name}` — all plans in stream done
- `STREAM_FAILED: {stream_name}` — a plan failed; reports which one

**Secondary verification (independent of L2 return):** L1 checks SUMMARY.md existence for each plan in each stream:
```bash
# For each plan in stream's plans list:
{worktree_path}/.planning/phases/{phase_dir}/{phase}-{plan}-SUMMARY.md
```

If L2 reports success but SUMMARY.md is missing, treat as failure and fall back.

Note on DISP-04 language: "sentinel file presence" in the success criteria refers to the pattern described in REQUIREMENTS.md. In practice, the L2 agent cannot write files (no Write tool), so completion detection relies on the L2's text return. The SUMMARY.md existence check is the file-based verification. This does NOT require L2 to write a new `STREAM_COMPLETE.md` file.

### Pattern 6: Worktree Merge and Cleanup (Step 5 of Hierarchy Path)

After all L2s complete successfully:

1. **Merge each worktree branch to main:**
   ```bash
   git merge {worktree_branch} --no-ff -m "merge(hierarchy): stream {stream_name} into main"
   ```
   If any merge fails (conflict), user is notified and must resolve manually.

2. **Reconcile STATE.md before removing worktrees:**
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" state-reconcile
   ```
   `state-reconcile` reads the worktree registry to find all active worktrees. Must run before `worktree-remove` (which clears registry entries).

3. **Remove each worktree:**
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-remove {stream_name}
   ```

4. **Commit state reconciliation result:**
   ```bash
   node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" commit "docs(phase-{X}): reconcile hierarchy execution STATE.md" --files .planning/STATE.md .planning/worktree-registry.json
   ```

### Pattern 7: Fallback to Flat Mode (DISP-06)

Any failure in the hierarchy path falls back to flat:

```
FALLBACK TRIGGER:
  - Partitioner fails or returns empty streams
  - Any worktree-create fails (after cleaning up partial worktrees)
  - Any L2 spawn fails
  - L2 reports STREAM_FAILED
  - Merge conflict on worktree branch

FALLBACK ACTION:
  1. Clean up all worktrees created so far (worktree-remove with --force)
  2. Notify user: "Hierarchy execution failed at {step}. Falling back to flat mode."
  3. Execute existing flat execute_waves path with the same plan inventory
```

Fallback to flat guarantees the phase still completes even when hierarchy infrastructure fails.

### Recommended execute-phase.md Structure (new steps)

```
[existing steps]

<step name="discover_and_group_plans">
  ... (unchanged)
</step>

<step name="hierarchy_dispatch">
  IF parallelization AND hierarchy_enabled:
    1. Spawn gsd-partitioner → get stream map
    2. For each stream: worktree-create → get worktree path
    3. Spawn all L2s with run_in_background: true
    4. Wait for all L2 returns
    5. Verify SUMMARY.md existence per plan
    6. If all success: merge worktrees + state-reconcile + worktree-remove
    7. On any failure: cleanup + fallback to execute_waves
  ELSE:
    → proceed to execute_waves (unchanged)
</step>

<step name="execute_waves">
  ... (unchanged — handles both flat mode AND fallback from hierarchy)
</step>

[existing steps continue unchanged]
```

### Anti-Patterns to Avoid

- **Reading `hierarchy.enabled` directly from config.json in the workflow:** The workflow must use the init JSON output. Workflows never read config.json directly — all config access goes through `gsd-tools init`.
- **Using TeamCreate to spawn L2s:** Bug #32731 blocks Agent() calls from team members. L2 MUST be spawned as a standalone subagent via `Task()`, not as a team teammate.
- **Running `state-reconcile` after `worktree-remove`:** `state-reconcile` reads the worktree registry. If worktrees are removed first, the registry is empty and reconciliation produces no output. Order: reconcile → then remove.
- **Blocking on L2 completion via SendMessage:** STATE.md flags this as a known reliability concern. Use L2 return text as the primary signal. Do not implement a SendMessage-based detection loop.
- **Assuming `worktree-create` path is relative:** `cmdWorktreeCreate` returns a relative `path` field (e.g., `.claude/worktrees/stream-a`). For L2 prompt injection, construct an absolute path: `{project_root}/.claude/worktrees/{stream-name}`. The L2 agent body requires an absolute path.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Worktree creation/registration | Custom `git worktree add` + JSON writes | `gsd-tools.cjs worktree-create` | Phase 1 already handles timestamped branches, registry, and error cases |
| Worktree removal/cleanup | Custom git + registry file manipulation | `gsd-tools.cjs worktree-remove` | Handles --force, branch deletion, self-healing registry |
| Plan partition into streams | Dependency/wave analysis in workflow | Spawn `gsd-partitioner` → calls `gsd-tools.cjs hierarchy-partition` | Phase 1+2 built this with union-find, stream cap enforcement |
| STATE.md merge from worktrees | Reading/merging STATE.md files manually | `gsd-tools.cjs state-reconcile` | Phase 1 built this with correct merge semantics (append, last-write, dedup) |
| Stream assignment communication to L2 | Custom IPC or file-based messaging | L2 prompt `<stream>` + `<worktree>` tags | Agent prompt IS the IPC mechanism; no additional infrastructure needed |

**Key insight:** Phase 3 is almost entirely orchestration — wiring together what Phases 1 and 2 built. The only new code is a small patch to `init.cjs` (expose hierarchy config) and test coverage. The workflow change is Markdown prose, not code.

---

## Common Pitfalls

### Pitfall 1: `init execute-phase` Missing `hierarchy_enabled`
**What goes wrong:** Workflow reads `HIERARCHY_ENABLED` from init JSON but the field is absent — evaluates as falsy, hierarchy path never triggers even with correct config.
**Why it happens:** `cmdInitExecutePhase` was written before hierarchy was designed. `loadConfig()` returns `hierarchy` but `cmdInitExecutePhase` doesn't forward it.
**How to avoid:** Patch `init.cjs` `cmdInitExecutePhase` to include `hierarchy_enabled: config.hierarchy.enabled` and `hierarchy_max_l2_agents: config.hierarchy.max_l2_agents`. Add a test in `tests/init.test.cjs`.
**Warning signs:** Hierarchy never activates even with `hierarchy.enabled: true` in config.json.

### Pitfall 2: Relative vs Absolute Worktree Path
**What goes wrong:** `worktree-create` returns `path: ".claude/worktrees/stream-a"` (relative). L1 injects this into the L2 `<worktree>` prompt tag. L2 constructs all paths as `{worktree_path}/...` — but the CWD in the agent context may differ, causing file operations to fail.
**Why it happens:** The `cmdWorktreeCreate` `path` field is relative to the project root. Agents need absolute paths.
**How to avoid:** L1 must convert to absolute before injecting: `{project_root}/{relative_path}`. The project root can be derived from the `phase_dir` path or by prepending the CWD from the init command context.
**Warning signs:** L2 reports STREAM_FAILED with "file not found" on plan files that clearly exist.

### Pitfall 3: state-reconcile After worktree-remove
**What goes wrong:** Worktrees removed first → registry cleared → `state-reconcile` finds nothing → STATE.md from worktrees is lost.
**Why it happens:** `cmdWorktreeRemove` removes the registry entry as part of cleanup. `cmdStateReconcile` reads the registry to find worktrees to merge.
**How to avoid:** Always call `state-reconcile` before any `worktree-remove` calls. The correct merge/cleanup order is: (1) `git merge` each branch, (2) `state-reconcile`, (3) `worktree-remove` for each stream.
**Warning signs:** `state-reconcile` output says `nothing to reconcile: no worktrees registered` even when worktrees were used.

### Pitfall 4: Partial Worktree Creation on Failure
**What goes wrong:** 3 streams planned. Worktrees for stream-a and stream-b created. Worktree for stream-c fails. Fallback to flat mode starts — but stream-a and stream-b worktrees are now orphaned.
**Why it happens:** Error handling that falls back without cleaning up successfully-created worktrees.
**How to avoid:** Track which worktrees were created (keep a list). On any failure, iterate the list and call `worktree-remove --force` for each before falling back to flat.
**Warning signs:** `git worktree list` shows leftover `.claude/worktrees/*` entries after a failed hierarchy run.

### Pitfall 5: L2 spawn — Missing Project Root in Worktree Path
**What goes wrong:** L2 prompt receives `<worktree>.claude/worktrees/stream-a</worktree>` (relative). L2 agent body says "use `<worktree>` as absolute base for ALL paths". But it's relative, so all L3 file ops fail.
**Why it happens:** Forgetting to resolve the absolute path before injecting into L2 prompt.
**How to avoid:** In the workflow, resolve `{PROJECT_ROOT}` (from bash `$(git rev-parse --show-toplevel)` or from the phase_dir path) and construct the absolute worktree path explicitly.

### Pitfall 6: Blocking on SendMessage Instead of Return Text
**What goes wrong:** Implementing L2 completion detection via SendMessage/receiving pattern, which is documented in STATE.md as "best-effort" and unreliable.
**Why it happens:** Misreading DISP-04 ("sentinel file") as requiring a new file write by L2.
**How to avoid:** L2's text return value IS the completion signal. For file-based verification, check SUMMARY.md existence per plan. Do not implement a SendMessage polling loop.
**Warning signs:** Workflow hangs waiting for a message that never arrives.

---

## Code Examples

Verified from project codebase:

### init.cjs Patch — Adding hierarchy to init output
```javascript
// In cmdInitExecutePhase, add to the result object (around line 33):
parallelization: config.parallelization,
hierarchy_enabled: config.hierarchy.enabled,        // ADD THIS
hierarchy_max_l2_agents: config.hierarchy.max_l2_agents,  // ADD THIS
```
Source: `get-shit-done/bin/lib/init.cjs` lines 26-78 (result object) + `core.cjs` line 127 (`hierarchy: parsed.hierarchy ?? defaults.hierarchy`).

### Workflow Condition Check
```bash
# In execute-phase.md, after discover_and_group_plans:
HIERARCHY_ENABLED=$(echo "$INIT" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); process.stdout.write(String(d.hierarchy_enabled))")
# OR: parse from INIT JSON using existing jq/python/node pattern used elsewhere in the workflow
```
Note: The workflow already parses `parallelization` from `INIT` JSON. `hierarchy_enabled` is parsed the same way once added to init output.

### worktree-create Return and Absolute Path Construction
```bash
# CLI call:
WT_RESULT=$(node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-create stream-a --raw)
# WT_RESULT JSON: { "created": true, "stream": "stream-a", "branch": "gsd/hierarchy/...", "path": ".claude/worktrees/stream-a" }

# Extract relative path and convert to absolute:
PROJECT_ROOT=$(git -C "$PHASE_DIR" rev-parse --show-toplevel)
WT_PATH="$PROJECT_ROOT/.claude/worktrees/stream-a"
```
Source: `get-shit-done/bin/lib/hierarchy.cjs` `cmdWorktreeCreate()` — `path` is `toPosixPath(path.relative(cwd, worktreePath))`.

### L2 Spawn Pattern
```
Task(
  subagent_type="gsd-sub-orchestrator",
  run_in_background=true,
  prompt="
    <worktree>/absolute/path/to/.claude/worktrees/stream-a</worktree>
    <phase>03-l1-dispatch-integration</phase>
    <phase_dir>03-l1-dispatch-integration</phase_dir>
    <stream>{ \"name\": \"stream-a\", \"plans\": [\"03-01-PLAN.md\"] }</stream>
  "
)
```
Source: `agents/gsd-sub-orchestrator.md` `<stream_context>` section — documents exactly these tag names.

### state-reconcile Before worktree-remove
```bash
# Correct order:
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" state-reconcile
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-remove stream-a
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-remove stream-b
```
Source: `get-shit-done/bin/lib/hierarchy.cjs` `cmdStateReconcile()` — reads registry first, then `cmdWorktreeRemove()` removes registry entries.

### Fallback Cleanup Pattern
```bash
# On any hierarchy failure, cleanup created worktrees:
for STREAM in "${CREATED_WORKTREES[@]}"; do
  node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" worktree-remove "$STREAM" --force
done
# Then proceed to existing execute_waves
```
Source: `cmdWorktreeRemove` with `--force` handles orphaned/missing worktrees without error.

---

## State of the Art

| Old Approach | Current Approach | Applies To |
|--------------|------------------|------------|
| Flat execute_waves (L1 spawns L3 executors directly) | New hierarchy path (L1 → L2 coordinators → L3 executors) when hierarchy.enabled | execute-phase.md dispatch |
| `isolation: worktree` frontmatter | Explicit `<worktree>` path in prompt (bug #27749 workaround) | All L2 spawns |
| TeamCreate + SendMessage for coordination | Standalone subagent spawn via Task() (bug #32731 workaround) | L2 spawn pattern |

**Unchanged by Phase 3:**
- Existing flat `execute_waves` logic — unchanged, still used when hierarchy is off and as fallback
- All existing checkpoint handling, verification, and roadmap update steps — unchanged
- All Phase 1 + Phase 2 deliverables — consumed as-is

---

## Open Questions

1. **What is the project root for absolute path construction?**
   - What we know: `worktree-create` returns a relative path. L2 needs absolute. The workflow has `phase_dir` from init (e.g., `.planning/phases/03-l1-dispatch-integration`). The project root can be derived as the parent of `.planning/`.
   - What's unclear: Whether the workflow should use `git rev-parse --show-toplevel` or derive from `phase_dir`.
   - Recommendation: Use `$(git rev-parse --show-toplevel)` — reliable and already used elsewhere in GSD workflows.

2. **Should single-stream partition results use hierarchy or fall back to flat?**
   - What we know: If all plans are in 1 stream (no parallelism possible), spawning a worktree + L2 adds overhead for no benefit.
   - What's unclear: Whether the overhead matters enough to warrant a special case.
   - Recommendation: If partitioner returns exactly 1 stream, skip hierarchy and use flat mode. Notify user: "Only 1 stream identified — using flat execution mode." This keeps overhead proportional to benefit and avoids unnecessary worktree churn.

3. **How does L1 read L2 return text when `run_in_background: true`?**
   - What we know: Background tasks run concurrently. The orchestrator collects results after all complete. Task() return values are available once the background task finishes.
   - What's unclear: The exact API for reading background task return values in execute-phase.md prose (it's a workflow document, not code).
   - Recommendation: The workflow prose should instruct the orchestrator to "after spawning all L2s, wait for background task completion and read each return value." The actual mechanism is Claude Code's native background task handling. Document that results are collected after all background tasks complete, then parsed for `STREAM_COMPLETE:`/`STREAM_FAILED:` prefix.

4. **Should merge conflicts halt the phase or trigger flat fallback?**
   - What we know: Merge conflict means conflicting changes in the same file from different streams — this should not happen if partition correctly identifies non-conflicting streams.
   - What's unclear: Whether a conflict is a hierarchy failure (fallback to flat) or a user-action-required state.
   - Recommendation: Merge conflict is a user-action-required state, not an auto-fallback trigger. Present the conflict to the user. Do not attempt flat fallback since plans are already executed in worktrees — there's nothing to fall back to at that point.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None — invoked via `npm test` → `node scripts/run-tests.cjs` |
| Quick run command | `npm test 2>&1 \| grep -E "init\|hierarchy\|FAIL\|pass\|fail"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISP-01 | `init execute-phase` returns `hierarchy_enabled` and `hierarchy_max_l2_agents` | unit | `npm test 2>&1 \| grep init` | ❌ Wave 0 — add to `tests/init.test.cjs` |
| DISP-01 | When `hierarchy_enabled: false`, workflow takes flat path (existing behavior) | manual/integration | Run `/gsd:execute-phase` with hierarchy off — zero behavior change | manual |
| DISP-02 | L2 spawn uses `run_in_background: true` | inspection | Read execute-phase.md for `run_in_background` presence | ❌ Wave 0 — grep after write |
| DISP-03 | Worktree path is injected as absolute into L2 `<worktree>` tag | inspection | Read execute-phase.md for absolute path construction | ❌ Wave 0 — grep after write |
| DISP-04 | L2 return text `STREAM_COMPLETE`/`STREAM_FAILED` is parsed correctly | unit | `npm test 2>&1 \| grep hierarchy` — existing hierarchy.test.cjs tests wiring | ✅ hierarchy.test.cjs covers CLI; workflow parsing is manual |
| DISP-05 | `state-reconcile` is called before `worktree-remove` | inspection | Read execute-phase.md for order of calls | ❌ Wave 0 — grep after write |
| DISP-06 | Fallback on any failure — partial worktree cleanup then flat | inspection + manual | Read execute-phase.md for fallback logic | ❌ Wave 0 — inspection after write |

### Sampling Rate
- **Per task commit:** `npm test 2>&1 | grep -E "FAIL|init"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/init.test.cjs` — add tests for `hierarchy_enabled` and `hierarchy_max_l2_agents` in `init execute-phase` output (covers DISP-01). This is a unit test patch to an existing file.

*(All other DISP requirements are verified by inspection of the workflow Markdown — no additional test framework needed. The workflow itself is not executable code that unit tests can cover; correctness is verified by reading the resulting file.)*

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `get-shit-done/bin/lib/hierarchy.cjs` — all four Phase 1 commands, their signatures, return shapes, and order-of-operations constraints
- Direct code inspection: `get-shit-done/bin/lib/init.cjs` lines 26-78 — `cmdInitExecutePhase` return object; confirmed `hierarchy` is absent from output
- Direct code inspection: `get-shit-done/bin/lib/core.cjs` lines 68-132 — `loadConfig()` with `hierarchy` defaults; `config.hierarchy` is available to init
- Direct code inspection: `get-shit-done/workflows/execute-phase.md` — full workflow structure; identified insertion point and existing flat path
- Direct code inspection: `agents/gsd-sub-orchestrator.md` — confirmed L2 return text format (`STREAM_COMPLETE:`, `STREAM_FAILED:`), prompt tag names (`<worktree>`, `<stream>`, `<phase>`, `<phase_dir>`)
- Direct code inspection: `agents/gsd-partitioner.md` — confirmed partitioner accepts `<phase_dir>` tag, returns raw JSON from `hierarchy-partition`
- CLI test: `node gsd-tools.cjs init execute-phase 3` — confirmed `hierarchy` NOT in output (returns false for `'hierarchy' in d`)
- `.planning/REQUIREMENTS.md` — DISP-01 through DISP-06 requirement text
- `.planning/STATE.md` — all locked decisions including bug #27749, #32731, SendMessage reliability concern

### Secondary (MEDIUM confidence)
- `.planning/phases/02-agent-definitions/02-RESEARCH.md` — confirmed L2 tool set, completion signal design, sentinel file approach
- `.planning/phases/01-foundation-utilities/01-RESEARCH.md` — confirmed worktree path convention `.claude/worktrees/{stream-name}`

### Tertiary (LOW confidence)
- None — all findings verified from codebase directly

---

## Metadata

**Confidence breakdown:**
- `init.cjs` gap (missing hierarchy in output): HIGH — verified by live CLI test and code inspection
- Correct step order (reconcile before remove): HIGH — verified from hierarchy.cjs implementation
- Absolute path requirement for L2: HIGH — verified from gsd-sub-orchestrator.md body instructions
- Open question on single-stream optimization: MEDIUM — derived from requirements, not explicit design decision
- Background task return value mechanism: MEDIUM — standard pattern, but workflow prose details are Claude's Discretion

**Research date:** 2026-03-12
**Valid until:** 2026-06-12 (all findings from stable project codebase; no external dependencies)
