# Phase 2: Agent Definitions - Research

**Researched:** 2026-03-12
**Domain:** Claude agent definition files — frontmatter schema, tool restrictions, L2/L3 persona design, partitioner logic
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | `agents/gsd-sub-orchestrator.md` with `tools: Agent, Read` in frontmatter | Agent frontmatter schema verified from existing agents + `agent-frontmatter.test.cjs`; `tools:` field is a space-separated string |
| AGNT-02 | `mcpServers: []` in L2 frontmatter to enforce MCP isolation | Frontmatter field confirmed from Claude agent spec; empty array prevents any MCP access |
| AGNT-03 | L2 receives worktree path via `<worktree>` tag in prompt (bug #27749 workaround) | Workaround pattern documented in STATE.md and 01-CONTEXT.md; L2 body must read `<worktree>` from prompt and use it as absolute base for all file paths |
| AGNT-04 | L2 validates L3 completion by file existence (not content) | `fs.existsSync` or `Read` tool on a specific path; do NOT read SUMMARY.md content to avoid context budget drain |
| AGNT-05 | L2 spawns L3 executors for its assigned plan group and reports completion status to L1 | L2 only has `Agent` + `Read` tools — spawning L3 is via `Agent()` call; completion report is a sentinel file (`STREAM_COMPLETE.md`/`STREAM_FAILED.md`) |
| PART-01 | L3 partitioner spawned by L1 before L2 dispatch — analyzes all plans in a phase | Partitioner is an L3 agent (full tool set including Bash/Read/Glob) accepting phase plan list |
| PART-02 | Partitioner reads plan dependencies and file overlap to group plans into non-conflicting streams | `hierarchy-partition` command from Phase 1 already implements this logic — partitioner agent calls it via `gsd-tools.cjs hierarchy-partition` |
| PART-03 | Partitioner returns structured partition map (which L2 gets which plans) | Output format: JSON `{ streams: [{ name, plans: [], worktree_branch }] }` — same schema as `hierarchy-partition` CLI output |
| PART-04 | Partition respects wave ordering — cross-wave plans never in same parallel stream | Enforced by the `hierarchy-partition` algorithm from Phase 1; partitioner agent is a thin caller of that tool, not a reimplementation |
</phase_requirements>

---

## Summary

Phase 2 creates two agent definition files: `agents/gsd-sub-orchestrator.md` (L2 coordinator) and `agents/gsd-partitioner.md` (L3 partitioner). Both are Markdown files with Claude agent frontmatter. The work is primarily authoring correct instructions, not coding — but getting the frontmatter right and passing all existing agent tests is load-bearing.

The project has a live test suite (`tests/agent-frontmatter.test.cjs`) that validates all `agents/gsd-*.md` files for required frontmatter fields (`name`, `description`, `tools`, `color`, `skills:`), anti-heredoc instruction (for Write-capable agents), and named agent spawn correctness. Both new agents must pass these tests on creation. The `agent-frontmatter.test.cjs` `SPAWN` suite also checks that all `subagent_type="..."` references in workflows/commands match a real agent file — so when Phase 3 references `gsd-sub-orchestrator` or `gsd-partitioner` in dispatch, those names must already exist.

The L2 sub-orchestrator has a deliberately narrow tool set (`Agent, Read`, no Bash, no MCP) to enforce the architectural boundary: L2 coordinates but never executes. The L3 partitioner is a thin wrapper that calls `gsd-tools.cjs hierarchy-partition` (Phase 1 deliverable) and returns the JSON map — it does not reimplement partition logic. Both agents must encode the two known runtime bug workarounds: bug #27749 (inject worktree path via `<worktree>` tag, never rely on `isolation: worktree` frontmatter) and bug #32731 (L2 must be spawned as a standalone subagent, not a team teammate, to preserve its ability to call `Agent()`).

**Primary recommendation:** Write both agent files to match existing agent conventions exactly; run `npm test` after each file to catch frontmatter regressions early.

---

## Standard Stack

### Core (agent file format)
| Element | Value | Purpose | Why Standard |
|---------|-------|---------|--------------|
| Agent frontmatter | YAML between `---` markers | Declares identity, tool restrictions, color | Required by Claude agent system |
| `tools:` field | Comma-separated string (e.g., `Agent, Read`) | Restricts which tools the agent can call | Enforced at runtime; L2 must not have Bash or MCP |
| `mcpServers: []` | Empty array in frontmatter | Blocks all MCP access for this agent | MCP isolation requirement (AGNT-02) |
| `skills:` field | YAML list of skill names | Required by `agent-frontmatter.test.cjs` | Test will fail if absent |
| `color:` field | Named color string | Required by `agent-frontmatter.test.cjs` | Test will fail if absent |

### Supporting (existing project infrastructure)
| Asset | Purpose | When to Use |
|-------|---------|-------------|
| `get-shit-done/bin/lib/hierarchy.cjs` | `cmdHierarchyPartition()` — dependency-aware plan grouping | Partitioner agent calls `gsd-tools.cjs hierarchy-partition` which delegates to this |
| `tests/agent-frontmatter.test.cjs` | Validates all agent frontmatter fields | Run `npm test` after creating each new agent file |
| `agents/gsd-executor.md` | Reference pattern for L3 agent structure | Body structure, anti-heredoc instruction, completion format |
| `agents/gsd-integration-checker.md` | Reference for read-only agent (no Write) | Confirms `# hooks:` is optional for non-Write agents |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tools: Agent, Read` for L2 | `tools: Agent, Read, Bash` | Giving L2 Bash would allow it to do execution work, violating the L2=coordinator constraint |
| Thin partitioner calling gsd-tools.cjs | Partitioner reimplementing partition logic | Duplication and divergence risk; gsd-tools.cjs is the single source of truth for partition algorithm |
| File-existence check for L3 completion | Reading SUMMARY.md content | Reading content fills L2's context budget; existence check is sufficient and lightweight |

**Installation:** No new dependencies. Agent files are plain Markdown.

---

## Architecture Patterns

### Recommended File Structure
```
agents/
├── gsd-sub-orchestrator.md   # New: L2 coordinator persona
├── gsd-partitioner.md        # New: L3 partitioner persona
└── ... (existing agents)
```

### Pattern 1: Agent Frontmatter Schema
**What:** Every agent in `agents/gsd-*.md` starts with a YAML frontmatter block followed by role instructions.
**When to use:** Both new agents follow this exactly.
**Verified from:** `agents/gsd-executor.md`, `agents/gsd-integration-checker.md`, `tests/agent-frontmatter.test.cjs`

```markdown
---
name: gsd-sub-orchestrator
description: Coordinates L3 executor agents for a single stream in a hierarchy-enabled execution. Spawned by /gsd:execute-phase L1 orchestrator.
tools: Agent, Read
mcpServers: []
color: blue
skills:
  - gsd-sub-orchestrator-workflow
# hooks:
#   PostToolUse:
#     - matcher: "Write|Edit"
#       hooks:
#         - type: command
#           command: "npx eslint --fix $FILE 2>/dev/null || true"
---
```

**Critical fields:**
- `tools: Agent, Read` — exactly these two; no Bash, no Write, no MCP tools
- `mcpServers: []` — must be present and empty (AGNT-02)
- `skills:` — must be present; skill name follows `gsd-*-workflow` convention enforced by test
- `color:` — must be present; any valid color name

### Pattern 2: `<worktree>` Tag Injection (Bug #27749 Workaround)
**What:** L2 body instructs agents to read a `<worktree>` tag from the prompt and use it as the absolute base path for all file operations, instead of relying on `isolation: worktree` frontmatter.
**Why:** Bug #27749 — the `isolation: worktree` frontmatter feature does not reliably set cwd for spawned agents. The workaround is explicit path injection in the prompt.
**Verified from:** STATE.md "Decisions" and 01-CONTEXT.md locked decisions.

```markdown
<worktree_context>
The orchestrator injects your assigned worktree path via a `<worktree>` tag.

Extract it at the start of execution:
  WORKTREE_PATH = the value from the <worktree> tag in your prompt

Use this path as the absolute base for ALL file references. Do not use `.` or
relative paths — they will resolve to the wrong directory.
</worktree_context>
```

### Pattern 3: File-Existence Completion Check (AGNT-04)
**What:** L2 checks that L3 wrote a sentinel file (`SUMMARY.md`) to know it completed — without reading the file's content.
**Why:** Reading SUMMARY.md content would fill L2's context window unnecessarily. Existence is sufficient signal.
**Verified from:** Phase 2 success criteria #3 in ROADMAP.md and REQUIREMENTS.md AGNT-04.

```markdown
<completion_check>
After spawning each L3 agent, verify completion by checking file existence only:

1. Use the Read tool to attempt reading `{worktree_path}/SUMMARY.md`
2. If the Read succeeds (file exists) → task complete
3. If the Read fails (file not found) → L3 did not complete; report failure

Do NOT parse or process the SUMMARY.md content. Existence is the signal.
</completion_check>
```

### Pattern 4: L2 Spawns L3 via Agent Tool
**What:** L2 has `Agent` in its tool list, so it can spawn L3 subagents. This is intentional — L2 coordinates by spawning L3s.
**Why:** Bug #32731 means L2 must NOT be a team teammate (TeamCreate). Standalone subagent spawning via Agent() is unaffected by this bug.
**Verified from:** STATE.md "Decisions" — "L2s are standalone subagents, not agent team teammates: teammates cannot call Agent() (bug #32731), which blocks L2→L3 chain"

```markdown
<spawn_protocol>
For each plan in your assigned stream:
1. Spawn an L3 executor via the Agent tool with:
   - subagent_type: "gsd-executor"
   - prompt: include <worktree> tag with your assigned worktree path
   - run_in_background: false (L2 processes plans sequentially within its stream)
2. Check completion via file existence (see completion_check section)
3. If L3 fails: write STREAM_FAILED.md and return immediately
</spawn_protocol>
```

### Pattern 5: Partitioner Agent as Thin CLI Caller
**What:** `gsd-partitioner.md` accepts a phase directory path, calls `gsd-tools.cjs hierarchy-partition`, and returns the JSON result to L1.
**Why:** The partition algorithm lives in `hierarchy.cjs` (Phase 1 deliverable). The agent is a workflow wrapper, not a reimplementation.
**Verified from:** REQUIREMENTS.md PART-01 through PART-04; hierarchy.cjs already implements the algorithm.

```markdown
<execution>
1. Read the phase directory path from the <phase_dir> tag in your prompt
2. Run: node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" hierarchy-partition <phase_dir>
3. Return the JSON output directly to the orchestrator — do not modify it
</execution>
```

### Anti-Patterns to Avoid

- **Giving L2 Bash tool:** Violates architectural constraint. L2 must coordinate only. If L2 has Bash, it could do execution work, defeating the purpose of the hierarchy.
- **L2 reading SUMMARY.md content:** Fills context budget. Use `Read` only to detect file existence (let it fail gracefully).
- **Partitioner reimplementing partition logic:** `hierarchy-partition` CLI already handles dependency analysis, wave ordering, file overlap, and stream capping. The agent must call it, not replace it.
- **Omitting `skills:` from frontmatter:** `agent-frontmatter.test.cjs` will fail. The `skills:` key must be present even if the skill doesn't exist yet (empty list `skills: []` is acceptable but a named skill following `gsd-*-workflow` convention is preferred).
- **Using `subagent_type` in workflows that doesn't match an existing agent filename:** `agent-frontmatter.test.cjs` SPAWN suite cross-checks all `subagent_type="..."` references. New agent names must be registered before Phase 3 references them.
- **Relying on `isolation: worktree` in L2 frontmatter:** Bug #27749 — this does not work reliably. Always inject path via `<worktree>` tag.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Partition algorithm | Custom dependency/overlap logic in partitioner agent | `gsd-tools.cjs hierarchy-partition` | Phase 1 already delivers this; reimplementing creates divergence and ignores stream cap enforcement |
| Worktree path lookup | Reading registry in L2 agent | L2 receives path via `<worktree>` tag from L1 | L1 is the one creating worktrees and knows the paths; L2 is a consumer |
| Completion signaling | Custom JSON status files with complex schema | Simple `SUMMARY.md` existence check | SUMMARY.md already written by gsd-executor; no additional sentinel file needed for L3→L2 |

**Key insight:** Phase 2 is about encoding correct instructions in agent files, not building new logic. The only new logic is L2's sequential spawn loop and the file-existence check — everything else delegates to existing tools.

---

## Common Pitfalls

### Pitfall 1: `agent-frontmatter.test.cjs` Failures
**What goes wrong:** New agent file added but test suite fails — missing `skills:`, `color:`, or `name:` field, or skill name doesn't match `gsd-*-workflow` pattern.
**Why it happens:** The test dynamically scans all `agents/gsd-*.md` files. A new file is immediately tested.
**How to avoid:** After writing each agent file, run `npm test 2>&1 | grep -E "agent-frontmatter|FAIL"`. Fix frontmatter before moving on.
**Warning signs:** Test output mentions the new agent name with "missing skills:" or "Invalid skill name".

### Pitfall 2: L2 Spawning L3 as Team Teammate (Bug #32731)
**What goes wrong:** L2 tries to use TeamCreate or is spawned as part of a team, which blocks its ability to call Agent() for L3 spawning.
**Why it happens:** Confusion between agent teams and standalone subagents.
**How to avoid:** L2 must be spawned as a standalone subagent (via `Agent()` tool call, not TeamCreate). The L2 agent body should note it must not attempt TeamCreate itself.
**Warning signs:** L3 spawn fails with "nested team" or "tool not available" error.

### Pitfall 3: Missing `mcpServers: []` Breaks MCP Isolation
**What goes wrong:** L2 agent can still call MCP tools if `mcpServers` is absent (inherits parent's MCP config) instead of blocked.
**Why it happens:** Forgetting to add `mcpServers: []` to frontmatter or assuming absence = block.
**How to avoid:** Explicitly include `mcpServers: []` in L2 frontmatter. Verify by inspecting the created file.
**Warning signs:** No test currently catches this — manual verification required.

### Pitfall 4: Partitioner Output Format Mismatch
**What goes wrong:** Partitioner returns a different JSON schema than what Phase 3 dispatch expects for `streams[].plans` and `streams[].name`.
**Why it happens:** Partitioner agent reformats the `hierarchy-partition` CLI output instead of passing it through raw.
**How to avoid:** Partitioner body must return the raw JSON from `hierarchy-partition` without transformation. Document the schema in the agent body so Phase 3 authors know what to expect: `{ streams: [{ name: string, plans: string[], worktree_branch: null }] }`.
**Warning signs:** Phase 3 plan fails to parse stream names or plan lists from partitioner output.

### Pitfall 5: `agent-frontmatter.test.cjs` SPAWN Check Blocks Phase 3
**What goes wrong:** Phase 3 workflow references `subagent_type="gsd-sub-orchestrator"` but the file doesn't exist yet (or has a different name), causing the spawn consistency test to fail.
**Why it happens:** Test cross-checks all `subagent_type="..."` in workflows against actual agent files. Order matters.
**How to avoid:** Phase 2 must create both agent files before Phase 3 adds workflow references. Agent name must be `gsd-sub-orchestrator` (matching file `agents/gsd-sub-orchestrator.md`) and `gsd-partitioner` (matching `agents/gsd-partitioner.md`).
**Warning signs:** `npm test` SPAWN suite fails after Phase 3 workflow edits.

---

## Code Examples

Verified patterns from project codebase:

### Minimal Valid Agent Frontmatter (non-Write agent)
```markdown
---
name: gsd-integration-checker
description: Verifies cross-phase integration and E2E flows. Checks that phases connect properly and user workflows complete end-to-end.
tools: Read, Bash, Grep, Glob
color: blue
skills: []
---
```
Source: `agents/gsd-integration-checker.md` — this is the minimum valid pattern. `skills: []` (empty) is accepted by the test.

### Full L2 Frontmatter Target
```markdown
---
name: gsd-sub-orchestrator
description: Coordinates L3 executor agents within a single partition stream during hierarchy-enabled phase execution. Spawned by /gsd:execute-phase L1 orchestrator.
tools: Agent, Read
mcpServers: []
color: blue
skills:
  - gsd-sub-orchestrator-workflow
---
```
Source: Derived from `agents/gsd-executor.md` pattern + AGNT-01/AGNT-02 requirements.

### L3 Partitioner Frontmatter Target
```markdown
---
name: gsd-partitioner
description: Analyzes a phase's plan list and returns a partition map assigning each plan to a named stream. Spawned by /gsd:execute-phase L1 orchestrator before L2 dispatch.
tools: Read, Bash
color: green
skills:
  - gsd-partitioner-workflow
---
```
Source: Derived from requirements — partitioner only needs Read + Bash to call `gsd-tools.cjs`. No Write needed (output is returned to caller, not written to file).

### How L1 Will Pass Data to Partitioner (for agent body authoring)
```bash
# L1 calls this — partitioner agent wraps it
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" hierarchy-partition \
  .planning/phases/02-agent-definitions

# Output schema (from hierarchy.cjs — Phase 1 deliverable):
# { streams: [{ name: "stream-a", plans: ["02-01-PLAN.md"], worktree_branch: null }] }
```
Source: `get-shit-done/bin/lib/hierarchy.cjs` cmdHierarchyPartition() output format.

### File-Existence Check Pattern in L2
```markdown
To verify L3 completed a plan, attempt to read the SUMMARY.md file.
If the Read tool succeeds, the plan is complete.
If it returns an error (file not found), the plan failed or was never started.

Example path to check:
{worktree_path}/.planning/phases/{phase_dir}/{phase}-{plan}-SUMMARY.md
```
Source: AGNT-04 requirement + ROADMAP.md Phase 2 success criteria #3.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `isolation: worktree` frontmatter | Explicit `<worktree>` path injection in prompt | Decision logged in STATE.md | Bug #27749 makes `isolation: worktree` unreliable — path injection is the required workaround |
| Agent Teams (TeamCreate/SendMessage) | Standalone subagents via Agent() | Decision logged in STATE.md | Bug #32731 blocks Agent() calls from team teammates — L2 must be standalone |

**Deprecated/outdated:**
- `isolation: worktree` frontmatter field: Do not use for worktree path resolution (bug #27749). Path must come from the prompt `<worktree>` tag.

---

## Open Questions

1. **What color should each new agent use?**
   - What we know: All existing agents have a color field. Colors used: yellow (executor), green (planner), cyan (researcher), orange (debugger), blue (integration-checker), purple (roadmapper).
   - What's unclear: Whether there's a convention for color meaning or it's purely aesthetic.
   - Recommendation: Use `blue` for L2 sub-orchestrator (coordinator role, matches integration-checker) and `green` for partitioner (analysis role, matches planner). Claude's discretion.

2. **Should L2 process plans in its stream sequentially or in parallel?**
   - What we know: L2 has the `Agent` tool and could spawn L3s with `run_in_background: true`. The Phase 2 scope is to define L2's persona, but the behavior matters for the body instructions.
   - What's unclear: Whether L2 should parallelize within its stream (gains speed) or serialize (simplifies state tracking).
   - Recommendation: Sequential within a stream. The partition algorithm already separated plans into non-conflicting streams — within a stream, plans may have sequential dependencies (different waves). L2 serializes; L1 parallelizes across streams.

3. **What skill names should these agents use?**
   - What we know: `agent-frontmatter.test.cjs` enforces that skill names match `gsd-*-workflow` pattern. The skills directory (`.claude/skills/`) does not exist in this project.
   - What's unclear: Whether the skill names must correspond to existing files or whether they're just labels.
   - Recommendation: From code inspection, skills are directory names under `.claude/skills/` or `.agents/skills/`. Since neither exists in this project, the skill name is a label. Use `gsd-sub-orchestrator-workflow` and `gsd-partitioner-workflow`. If the test checks existence, it would have already failed for other agents — it only checks naming convention.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None — invoked via `npm test` → `node scripts/run-tests.cjs` |
| Quick run command | `npm test 2>&1 \| grep -E "agent-frontmatter\|FAIL\|pass\|fail"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | `gsd-sub-orchestrator.md` has `tools: Agent, Read` in frontmatter | unit | `npm test 2>&1 \| grep agent-frontmatter` | ❌ Wave 0 — add to `tests/agent-frontmatter.test.cjs` |
| AGNT-02 | `gsd-sub-orchestrator.md` has `mcpServers: []` in frontmatter | unit | `npm test 2>&1 \| grep agent-frontmatter` | ❌ Wave 0 — add assertion to existing test |
| AGNT-01 | `gsd-sub-orchestrator.md` passes all existing frontmatter checks (name, description, tools, color, skills) | unit | `npm test 2>&1 \| grep agent-frontmatter` | ✅ Existing test auto-picks up new files |
| AGNT-01 | `gsd-partitioner.md` passes all existing frontmatter checks | unit | `npm test 2>&1 \| grep agent-frontmatter` | ✅ Existing test auto-picks up new files |
| PART-01-04 | Partitioner calls `hierarchy-partition` and returns correct JSON schema | unit | `npm test 2>&1 \| grep hierarchy` | ✅ `hierarchy.test.cjs` covers the CLI tool; partitioner agent body tested manually |

### Sampling Rate
- **Per task commit:** `npm test 2>&1 | grep -E "FAIL|agent-frontmatter"`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/agent-frontmatter.test.cjs` — add assertion that `gsd-sub-orchestrator` has `mcpServers:` field in frontmatter (AGNT-02). The existing required-fields test checks `name`, `description`, `tools`, `color` but not `mcpServers`. A new describe block for MCP isolation should be added.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `tests/agent-frontmatter.test.cjs` — all frontmatter validation rules, required fields, naming conventions
- Direct code inspection: `agents/gsd-executor.md` — canonical L3 agent body structure
- Direct code inspection: `agents/gsd-integration-checker.md` — read-only agent (no Write) frontmatter pattern
- Direct code inspection: `agents/gsd-planner.md` — frontmatter with skills, hooks, tool list
- Direct code inspection: `get-shit-done/bin/lib/hierarchy.cjs` — confirms `cmdHierarchyPartition()` exists and output format
- `.planning/REQUIREMENTS.md` — AGNT-01 through PART-04 requirement text
- `.planning/ROADMAP.md` — Phase 2 success criteria (5 items)

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` Decisions section — bug #27749 and #32731 workarounds documented as authoritative project decisions
- `.planning/phases/01-foundation-utilities/01-CONTEXT.md` — locked decisions from Phase 1

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Agent frontmatter schema: HIGH — validated directly from test file and existing agents
- Bug workarounds (#27749, #32731): HIGH — documented as project decisions in STATE.md
- Skill name convention: HIGH — `agent-frontmatter.test.cjs` line 84 shows exact regex `^gsd-[\w-]+-workflow$`
- L2 sequential vs parallel internal behavior: MEDIUM — derived from wave ordering logic, not explicitly stated

**Research date:** 2026-03-12
**Valid until:** 2026-06-12 (stable codebase; no external dependencies)
