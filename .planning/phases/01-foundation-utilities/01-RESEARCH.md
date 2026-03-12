# Phase 1: Foundation Utilities - Research

**Researched:** 2026-03-12
**Domain:** Node.js CLI tooling — git worktree management, dependency graph partitioning, file-based state reconciliation, JSON config schema extension
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `worktree-create` uses timestamped branch names: `gsd/hierarchy/{timestamp}-{stream-name}` to avoid "branch already checked out" errors (bug #27749 workaround)
- `worktree-create` registers in `.planning/worktree-registry.json` with creation time, branch name, stream assignment, and status
- `worktree-remove` cleans up branch + registry entry; `--force` handles orphaned/failed worktrees
- Worktree path: `.claude/worktrees/{stream-name}` (consistent with CLAUDE.md hierarchy convention)
- `hierarchy-partition` reads all plan files in a phase directory
- Groups plans into non-conflicting streams by analyzing `depends_on` fields and file overlap (files referenced in plan tasks)
- Respects existing wave ordering — plans in the same wave can split across streams, cross-wave deps stay sequential within a stream
- Output: JSON partition map `{ streams: [{ name, plans: [], worktree_branch }] }`
- `state-reconcile` merges STATE.md changes from worktree branches back to main
- Strategy: append-safe for task completion records, last-write for scalar fields (current phase, last activity)
- Reads worktree registry to know which branches to reconcile
- `hierarchy` section added to config.json schema: `{ enabled: bool, max_l2_agents: int }`
- Hierarchy activates ONLY when both `parallelization: true` AND `hierarchy.enabled: true`
- Default: `hierarchy.enabled: false` — zero behavior change for existing users

### Claude's Discretion
- Internal module organization within gsd-tools.cjs (new `hierarchy.cjs` lib module vs inline)
- Exact worktree registry JSON schema fields beyond the required ones
- Error message wording for partition failures
- Whether `state-reconcile` uses git merge or manual file merge

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | Feature flag `hierarchy.enabled` in config.json, default false — zero behavior change when disabled. Hierarchy activates ONLY when both `parallelization: true` AND `hierarchy.enabled: true`. | Config schema extension pattern in `config.cjs` and `core.cjs loadConfig()` — add `hierarchy` key with nested defaults exactly as `workflow` section is handled |
| FOUND-02 | `hierarchy-partition` command — dependency-aware plan grouping into non-conflicting streams | PLAN.md frontmatter fields (`wave`, `depends_on`) are already extracted via `extractFrontmatter()`; partition algorithm reads these, groups by wave, then splits same-wave plans by file overlap |
| FOUND-03 | `worktree-create` with timestamped branch names | `git worktree add <path> -b <branch>` via `execGit()`; timestamp from `Date.now()` or ISO format stripped of colons |
| FOUND-04 | `worktree-remove` with force-cleanup for orphaned worktrees | `git worktree remove --force <path>` + `git branch -D <branch>`; registry self-heal: skip missing entries silently |
| FOUND-05 | Worktree registry file `.planning/worktree-registry.json` tracking active worktrees | JSON file; read/write via `fs.readFileSync`/`fs.writeFileSync` with try-catch defaults to `{ worktrees: [] }` |
| FOUND-06 | `state-reconcile` for merging STATE.md from multiple worktrees | Manual file merge preferred (avoids git merge conflicts on plain-text STATE.md); read each worktree's STATE.md, append task completion records, last-write for scalar fields |
| FOUND-07 | Config schema extension — `hierarchy` section with `enabled` and `max_l2_agents` | Follow exact pattern used for `workflow` section; add defaults in `loadConfig()` in `core.cjs` and in `cmdConfigEnsureSection()` in `config.cjs` |
</phase_requirements>

---

## Summary

Phase 1 adds four new top-level commands (`worktree-create`, `worktree-remove`, `hierarchy-partition`, `state-reconcile`) and one config schema extension (`hierarchy` section) to `gsd-tools.cjs`. All code is pure Node.js with zero new dependencies — the project uses only `fs`, `path`, `child_process`, and its existing lib modules. The codebase is a well-established pattern: each command lives in a lib module, is called from the main switch in `gsd-tools.cjs`, and uses `output()`/`error()` for all I/O.

The two known worktree bugs (#27749 and #32731) are already documented in STATE.md. Bug #27749 ("branch already checked out") is why `worktree-create` must use timestamped branch names — identical branch names across worktrees cause git to refuse. The `state-reconcile` command is the most complex task: STATE.md has both YAML frontmatter (structured fields) and Markdown body sections (human-readable records). The merge strategy separates these concerns: frontmatter scalar fields use last-write, body completion records use append-only.

The recommended module organization is a new `get-shit-done/bin/lib/hierarchy.cjs` module, following the existing pattern (`core.cjs`, `state.cjs`, etc.). This keeps `gsd-tools.cjs` as a thin router and isolates all hierarchy logic for testability. All four commands fit naturally into one module given their shared dependency on the worktree registry.

**Primary recommendation:** Create `lib/hierarchy.cjs` with all four command implementations; register them in `gsd-tools.cjs`; extend `loadConfig()` and `cmdConfigEnsureSection()` for the `hierarchy` config key; add `tests/hierarchy.test.cjs`.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs` | built-in | File I/O for registry, STATE.md, plan files | Zero-dependency constraint; already used throughout |
| Node.js `path` | built-in | Cross-platform path joining | Already used throughout |
| Node.js `child_process` `execSync` | built-in | Git worktree commands | `execGit()` wrapper already handles error capture |

### Supporting (already in codebase)
| Library | Purpose | When to Use |
|---------|---------|-------------|
| `core.cjs` `execGit()` | Git command execution with error capture | All git worktree operations |
| `core.cjs` `loadConfig()` | Config loading with nested-key support | Reading `hierarchy.enabled` / `parallelization` |
| `frontmatter.cjs` `extractFrontmatter()` | Parse plan YAML frontmatter | Reading `wave`, `depends_on` from PLAN.md files |
| `core.cjs` `output()` / `error()` | Consistent CLI I/O | All command success/failure paths |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual STATE.md merge | `git merge` | Git merge on STATE.md would create merge commits on planning docs and may fail on concurrent edits; manual merge is deterministic |
| Inline code in gsd-tools.cjs | New `hierarchy.cjs` module | Inline is faster but violates existing pattern; module enables unit testing |
| Single flat registry array | Nested registry by stream | Flat array is simpler and sufficient for v1 |

**Installation:** No new dependencies required.

---

## Architecture Patterns

### Recommended Project Structure
```
get-shit-done/bin/lib/hierarchy.cjs   # New: all four hierarchy commands
get-shit-done/bin/gsd-tools.cjs       # Modify: add 4 new cases to switch
get-shit-done/bin/lib/core.cjs        # Modify: add hierarchy defaults to loadConfig()
get-shit-done/bin/lib/config.cjs      # Modify: add hierarchy to cmdConfigEnsureSection()
.planning/worktree-registry.json      # New: created at runtime, not shipped
tests/hierarchy.test.cjs              # New: tests for the module
```

### Pattern 1: Command Handler in lib module
**What:** Each gsd-tools command lives as a `cmdXxx()` function in a lib module, exported via `module.exports`, called from the `switch` in `gsd-tools.cjs`.
**When to use:** All four new commands follow this pattern exactly.
**Example (existing pattern from `commands.cjs`):**
```javascript
// Source: get-shit-done/bin/lib/commands.cjs
function cmdGenerateSlug(text, raw) {
  if (!text) error('text required for slug generation');
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  output({ slug }, raw, slug);
}
module.exports = { cmdGenerateSlug, ... };
```

### Pattern 2: Git Operations via execGit()
**What:** All git commands go through `execGit(cwd, argsArray)` which returns `{ exitCode, stdout, stderr }`.
**When to use:** `worktree-create`, `worktree-remove`, `state-reconcile` (reading worktree branches).
**Example (existing pattern from `core.cjs`):**
```javascript
// Source: get-shit-done/bin/lib/core.cjs
function execGit(cwd, args) {
  try {
    const escaped = args.map(a => {
      if (/^[a-zA-Z0-9._\-/=:@]+$/.test(a)) return a;
      return "'" + a.replace(/'/g, "'\\''") + "'";
    });
    const stdout = execSync('git ' + escaped.join(' '), { cwd, stdio: 'pipe', encoding: 'utf-8' });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: (err.stdout ?? '').toString().trim(), stderr: (err.stderr ?? '').toString().trim() };
  }
}
```

### Pattern 3: JSON Registry File with Graceful Defaults
**What:** Read JSON file, default to empty structure on missing/corrupt, write back atomically.
**When to use:** Worktree registry read/write.
```javascript
// Source: pattern derived from config.cjs
function readRegistry(cwd) {
  const registryPath = path.join(cwd, '.planning', 'worktree-registry.json');
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  } catch {
    return { worktrees: [] };
  }
}
function writeRegistry(cwd, data) {
  const registryPath = path.join(cwd, '.planning', 'worktree-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf-8');
}
```

### Pattern 4: Config Defaults with Nested Section
**What:** Add a new config key with defaults to both `loadConfig()` (runtime reads) and `cmdConfigEnsureSection()` (file creation). The `workflow` section is the exact precedent.
**When to use:** FOUND-07 — the `hierarchy` section.
```javascript
// Source: core.cjs loadConfig() — existing workflow pattern to replicate
const defaults = {
  // ... existing keys ...
  hierarchy: { enabled: false, max_l2_agents: 3 },
};
// In the return block:
hierarchy: parsed.hierarchy ?? defaults.hierarchy,
```

### Pattern 5: Frontmatter-driven Partition
**What:** Read PLAN.md files, extract `wave` and `depends_on` via `extractFrontmatter()`, group by wave, then partition same-wave plans into streams by file overlap.
**When to use:** `hierarchy-partition` command.
**Key insight:** `depends_on` is a PLAN.md frontmatter array field. Plans in the same wave with overlapping file paths go in the same stream (to avoid merge conflicts). Plans with no overlap can go in separate streams.

### Anti-Patterns to Avoid
- **Calling `git worktree add` without `-b`:** Without explicit branch name, git reuses the branch name derived from the path, which causes "already checked out" on repeated runs. Always pass `-b gsd/hierarchy/{timestamp}-{name}`.
- **Reading worktree registry without default fallback:** Registry may not exist on first run. Always default to `{ worktrees: [] }` on read failure.
- **Using `git merge` for STATE.md reconciliation:** Creates merge commits in planning docs, may leave conflict markers in STATE.md. Manual merge is deterministic.
- **Registering commands only in the switch, not in the module:** New commands must be exported from `hierarchy.cjs` AND added to `gsd-tools.cjs` switch AND required at the top of `gsd-tools.cjs`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git command execution | Custom `child_process.spawn` wrapper | `execGit()` from `core.cjs` | Already handles argument escaping, error capture, and cross-platform concerns |
| YAML frontmatter parsing | Custom YAML parser | `extractFrontmatter()` from `frontmatter.cjs` | Already used for all PLAN.md reads; known limitations (REG-04) are documented |
| Config reading | Direct `JSON.parse(fs.readFile)` | `loadConfig()` from `core.cjs` | Handles nested sections, migration, and fallback to defaults |
| CLI output | `console.log` directly | `output()` / `error()` from `core.cjs` | Handles `--raw` flag, large payload tmpfile routing, and `process.exit` |
| Timestamp generation | `new Date().toISOString()` inline | Pattern from `cmdCurrentTimestamp()` in `commands.cjs` | Consistent format, already tested |

**Key insight:** Every utility this phase needs already exists in the lib modules. The new code is orchestration logic (partition algorithm, registry management, merge logic), not infrastructure.

---

## Common Pitfalls

### Pitfall 1: "Branch Already Checked Out" (Bug #27749)
**What goes wrong:** `git worktree add .claude/worktrees/stream-a -b gsd/hierarchy/stream-a` fails on second run because git refuses to check out a branch that's already checked out in another worktree.
**Why it happens:** Git tracks which branches are "attached" to worktrees. Reusing branch names across runs or between worktrees triggers this.
**How to avoid:** Use `Date.now()` or ISO timestamp (colons removed) in branch name: `gsd/hierarchy/20260312T093045-stream-a`. Each `worktree-create` call produces a unique branch name.
**Warning signs:** `git worktree add` stderr contains "is already checked out".

### Pitfall 2: Orphaned Worktrees After Failures
**What goes wrong:** `worktree-create` creates the directory but then something fails before the registry entry is written. Subsequent runs see no registry entry but the directory exists, causing `git worktree add` to fail with "already exists".
**Why it happens:** Non-atomic create-then-register sequence.
**How to avoid:** In `worktree-remove --force`, check disk existence directly (`fs.existsSync`) independent of registry. `worktree-list` or registry self-heal should prune entries where the path no longer exists.
**Warning signs:** `git worktree add` stderr contains "already exists as a worktree".

### Pitfall 3: STATE.md Frontmatter vs Body Merge Confusion
**What goes wrong:** Treating all of STATE.md as free-form text and naive-appending from multiple worktrees produces duplicate frontmatter blocks.
**Why it happens:** STATE.md has two parts: YAML frontmatter (between `---` markers) and Markdown body. They need different merge strategies.
**How to avoid:** Use `extractFrontmatter()` to separate the two parts. For the body, scan for task-completion records by section header. For frontmatter, deserialize both, merge by last-write for scalar fields, reconstruct with `reconstructFrontmatter()`.
**Warning signs:** STATE.md file begins with two `---` blocks or has duplicate `## Performance Metrics` sections.

### Pitfall 4: Partition Creating Single-Plan Streams
**What goes wrong:** Partition algorithm puts every plan in its own stream, wasting L2 agents and creating too many worktrees.
**Why it happens:** Overly conservative file-overlap detection, or treating every plan as conflicting.
**How to avoid:** File overlap detection should only flag plans that reference the **same file path** in their task outputs, not plans in the same phase directory. Default to merging plans unless overlap is confirmed. Cap stream count at `max_l2_agents`.
**Warning signs:** Partition output has `streams.length === plans.length`.

### Pitfall 5: Config loadConfig() Not Returning `hierarchy` Key
**What goes wrong:** `loadConfig()` returns config without `hierarchy` key; callers crash on `config.hierarchy.enabled`.
**Why it happens:** Adding defaults to `cmdConfigEnsureSection()` but not to `loadConfig()` in `core.cjs` — the two places must stay in sync.
**How to avoid:** Update both. The `loadConfig()` function in `core.cjs` is the runtime reader; `cmdConfigEnsureSection()` in `config.cjs` is the file writer. Both need the new key.
**Warning signs:** `loadConfig()` tests in `core.test.cjs` fail with "undefined is not an object" when accessing `config.hierarchy`.

---

## Code Examples

### worktree-create: Git Commands
```javascript
// Source: pattern from core.cjs execGit() usage

// Create timestamped branch name
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, 'T').slice(0, 19);
const branch = `gsd/hierarchy/${timestamp}-${streamName}`;
const worktreePath = path.join(cwd, '.claude', 'worktrees', streamName);

// Create worktree
const addResult = execGit(cwd, ['worktree', 'add', worktreePath, '-b', branch]);
if (addResult.exitCode !== 0) {
  error(`Failed to create worktree: ${addResult.stderr}`);
}

// Register
const registry = readRegistry(cwd);
registry.worktrees.push({
  stream: streamName,
  branch,
  path: toPosixPath(path.relative(cwd, worktreePath)),
  created_at: new Date().toISOString(),
  status: 'active',
});
writeRegistry(cwd, registry);
```

### worktree-remove: Cleanup Sequence
```javascript
// Source: pattern derived from existing execGit usage

const entry = registry.worktrees.find(w => w.stream === streamName);
const absolutePath = entry ? path.resolve(cwd, entry.path) : path.join(cwd, '.claude', 'worktrees', streamName);

// Remove worktree (--force handles locked/orphaned)
if (fs.existsSync(absolutePath)) {
  execGit(cwd, ['worktree', 'remove', '--force', absolutePath]);
}

// Delete the branch
if (entry && entry.branch) {
  execGit(cwd, ['branch', '-D', entry.branch]);
}

// Remove from registry
registry.worktrees = registry.worktrees.filter(w => w.stream !== streamName);
writeRegistry(cwd, registry);
```

### hierarchy-partition: Algorithm Sketch
```javascript
// Source: original — derived from PLAN.md frontmatter structure

// 1. Read all PLAN.md files in phase directory
const planFiles = fs.readdirSync(phaseDir).filter(f => f.endsWith('-PLAN.md') || f === 'PLAN.md');

// 2. Extract wave + depends_on + file references from each
const plans = planFiles.map(f => {
  const content = fs.readFileSync(path.join(phaseDir, f), 'utf-8');
  const fm = extractFrontmatter(content);
  const fileRefs = extractFileReferences(content); // scan task bodies for file paths
  return { file: f, wave: parseInt(fm.wave || '1', 10), depends_on: fm.depends_on || [], fileRefs };
});

// 3. Group by wave (ascending)
const waves = groupBy(plans, p => p.wave);

// 4. Within each wave, partition by file overlap (disjoint sets)
// Plans sharing file references go in the same stream
// Plans with no overlap can go in separate streams
// Cap at max_l2_agents streams total

// 5. Output
output({ streams: [...] }, raw);
```

### state-reconcile: Merge Strategy
```javascript
// Source: pattern derived from state.cjs extractFrontmatter usage

// 1. Read registry to get worktree branches
// 2. For each branch, read STATE.md via git show <branch>:.planning/STATE.md
// 3. Extract frontmatter from main and each branch
// 4. Merge: last-write wins for scalars (current_phase, last_activity, stopped_at)
//    append-only for ## Performance Metrics and ## Accumulated Context entries
// 5. Reconstruct STATE.md with merged frontmatter + merged body
// 6. Write to main's .planning/STATE.md
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scattered bash in workflows | `gsd-tools.cjs` atomic commands | v1.20+ | New commands must be in gsd-tools, not inline bash |
| `parallelization` as boolean | `parallelization` supports both `true/false` and `{ enabled: bool }` object | Current | `loadConfig()` already handles both; new `hierarchy` key should be added as a new top-level key, not nested under `parallelization` |

**Deprecated/outdated:**
- `depth` key in config: migrated to `granularity` by `loadConfig()` automatically. Do not introduce new `depth`-style keys.

---

## Open Questions

1. **How does `state-reconcile` get the worktree branch's STATE.md content?**
   - What we know: `execGit(cwd, ['show', `${branch}:.planning/STATE.md`])` reads a file from a specific branch without checking it out. This is the standard approach.
   - What's unclear: If the worktree branch has uncommitted STATE.md changes (executor committed to worktree but hasn't pushed), `git show` reads the committed version. Uncommitted changes in the worktree directory would need `fs.readFileSync` from the worktree path instead.
   - Recommendation: Read from the worktree path on disk (`entry.path`) directly via `fs.readFileSync` — more reliable than `git show` since L2 agents commit within the worktree, not to the branch on main.

2. **What fields should the worktree-registry.json include beyond the required set?**
   - What we know: Required fields are creation time, branch name, stream assignment, status.
   - What's unclear: Whether `phase` should be tracked (useful for multi-phase cleanup), whether `pid` is needed (for detecting abandoned runs).
   - Recommendation: Add `phase` (string, from `--phase` arg) and `worktree_path` (absolute). Skip `pid` — overly complex for v1.

3. **How does `hierarchy-partition` detect file overlap?**
   - What we know: PLAN.md files have a `must_haves.artifacts` section listing output files, and task bodies reference file paths inline.
   - What's unclear: Whether to parse `must_haves.artifacts` (structured) or scan task text for file paths (brittle).
   - Recommendation: Parse the `must_haves` block via `extractFrontmatter()` artifacts field for structured overlap detection. Fall back to scanning for obvious patterns (`src/`, `tests/`, `.md` paths) in task text only if no artifacts block exists.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Node.js built-in test runner (`node:test`) |
| Config file | None — invoked via `node scripts/run-tests.cjs` |
| Quick run command | `node scripts/run-tests.cjs 2>&1 \| grep -E "hierarchy\|pass\|fail"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | `loadConfig()` returns `hierarchy.enabled: false` when key absent | unit | `npm test 2>&1 \| grep core` | ❌ Wave 0 — add to `tests/core.test.cjs` |
| FOUND-01 | `loadConfig()` reads `hierarchy.enabled: true` when set in config.json | unit | `npm test 2>&1 \| grep core` | ❌ Wave 0 — add to `tests/core.test.cjs` |
| FOUND-02 | `hierarchy-partition` groups plans by wave | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 — create `tests/hierarchy.test.cjs` |
| FOUND-02 | `hierarchy-partition` keeps cross-wave plans sequential | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 |
| FOUND-03 | `worktree-create` runs `git worktree add` with timestamped branch | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 |
| FOUND-04 | `worktree-remove --force` succeeds even when worktree dir missing | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 |
| FOUND-05 | Registry self-heals: `readRegistry` returns `{ worktrees: [] }` when file missing | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 |
| FOUND-06 | `state-reconcile` appends completion records from multiple worktrees | unit | `npm test 2>&1 \| grep hierarchy` | ❌ Wave 0 |
| FOUND-07 | `cmdConfigEnsureSection` writes `hierarchy.enabled: false` in created config | unit | `npm test 2>&1 \| grep config` | ❌ Wave 0 — add to `tests/config.test.cjs` |

### Sampling Rate
- **Per task commit:** `npm test` (full suite is fast — 16 test files, no external deps)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/hierarchy.test.cjs` — covers FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06
- [ ] `tests/core.test.cjs` — add `hierarchy` config key tests (FOUND-01, FOUND-07)
- [ ] `tests/config.test.cjs` — add `cmdConfigEnsureSection` hierarchy field test (FOUND-07)

Framework already installed. No new dependencies needed.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `get-shit-done/bin/gsd-tools.cjs` — command router pattern, all existing switch cases
- Direct code inspection: `get-shit-done/bin/lib/core.cjs` — `execGit()`, `loadConfig()`, `output()`, `error()`
- Direct code inspection: `get-shit-done/bin/lib/config.cjs` — `cmdConfigEnsureSection()`, `cmdConfigSet()`
- Direct code inspection: `get-shit-done/bin/lib/state.cjs` — STATE.md read/write patterns
- Direct code inspection: `get-shit-done/bin/lib/frontmatter.cjs` — `extractFrontmatter()` capabilities and known limitations
- Direct code inspection: `tests/core.test.cjs` — test pattern and structure
- `.planning/codebase/CONVENTIONS.md` — naming conventions, error handling, module exports

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Bug #27749 and #32731 documented workarounds confirmed as authoritative project decisions
- `.planning/phases/01-foundation-utilities/01-CONTEXT.md` — locked implementation decisions

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from direct code inspection; zero new dependencies
- Architecture: HIGH — all patterns derived from existing codebase, not hypothetical
- Pitfalls: HIGH — bugs #27749 and #32731 documented in project STATE.md; merge pitfalls derived from STATE.md structure inspection

**Research date:** 2026-03-12
**Valid until:** 2026-06-12 (stable codebase; no external dependencies)
